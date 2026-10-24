// What Ask Mycel shows of the runs it offered: each message's sender, subject and date, fetched
// through the proxy for display only, every time, and never stored (invariant 8), and each run's
// outcome once it started. Only the caller's own inboxes are read (connections' rule), and the
// same queries are made for one offer as for many.
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { GMAIL, headerValue, messageSchema } from "@/features/connections/gmail";
import { sourceClients } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import { requireRole, type Ctx } from "@/lib/ctx";
import type { AgentRunDetail, AgentRunOffer } from "../types";
import { isUnavailable } from "./recent-messages";
import { runs } from "./schema";

const metadataSchema = messageSchema
  .pick({ id: true, payload: true })
  .extend({ internalDate: z.string().default("0") });

/** Each offer's message and run, in the order given. */
export async function agentRunDetails(
  ctx: Ctx,
  offers: readonly AgentRunOffer[],
): Promise<AgentRunDetail[]> {
  requireRole(ctx, "admin", "member");
  if (offers.length === 0) return [];
  const runIds = offers.flatMap((offer) => (offer.runId === null ? [] : [offer.runId]));
  const [clients, started] = await Promise.all([
    sourceClients(
      ctx,
      offers.map((offer) => offer.connectionId),
    ),
    runIds.length === 0
      ? []
      : forOrg(ctx).select(runs, {
          columns: ["id", "status", "connectionId"],
          where: inArray(runs.id, runIds),
        }),
  ]);
  // A run is the caller's to see only on a connection they may read.
  const runOf = new Map(
    started.filter((run) => clients.has(run.connectionId)).map((run) => [run.id, run]),
  );
  const keys = [...new Set(offers.map(keyOf))];
  const messages = new Map(
    await Promise.all(
      keys.map(async (key) => {
        const offer = offers.find((one) => keyOf(one) === key);
        const client = offer === undefined ? undefined : clients.get(offer.connectionId);
        const message =
          offer === undefined || client === undefined ? null : await read(client, offer.sourceRef);
        return [key, message] as const;
      }),
    ),
  );
  return offers.map((offer) => {
    const run = offer.runId === null ? undefined : runOf.get(offer.runId);
    return {
      message: messages.get(keyOf(offer)) ?? null,
      run: run === undefined ? null : { id: run.id, status: run.status },
    };
  });
}

const keyOf = (offer: AgentRunOffer) => `${offer.connectionId}\n${offer.sourceRef}`;

async function read(client: SourceClient, sourceRef: string): Promise<AgentRunDetail["message"]> {
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of ["Subject", "From"]) query.append("metadataHeaders", name);
  try {
    const path = `${GMAIL}/messages/${encodeURIComponent(sourceRef)}?${query.toString()}`;
    const message = await client.get(path, metadataSchema);
    if (message === null) return null;
    const headers = message.payload?.headers;
    return {
      from: headerValue(headers, "From") ?? "",
      subject: headerValue(headers, "Subject") ?? "",
      receivedAt: new Date(Number(message.internalDate)),
    };
  } catch (error) {
    // Gmail or Nango refused, or the inbox went: the page says the message isn't available.
    if (!isUnavailable(error)) throw error;
    return null;
  }
}
