// The message each run started from, as its connection's readers see it: its subject and sender
// fetched through the proxy for display only (never stored, invariant 8), and where its thread
// opens in Gmail. The Runs page reads a page of them; a run's page reads its own.
import { GMAIL, gmailLink, headerValue, messageSchema } from "@/features/connections/gmail";
import { sourceClients } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { RunMessage } from "../types";
import { isUnavailable } from "./recent-messages";

type MessageOf = { id: string; connectionId: string; sourceRef: string };

const metadataSchema = messageSchema.pick({ id: true, threadId: true, payload: true });

/**
 * Each run's message, by run ID, for the runs on a connection the caller may read; a run on any
 * other has none. A message Gmail can't give has no subject, sender or link. One query for the
 * connections, then one proxy call a run.
 */
export async function messagesOf(
  ctx: Ctx,
  runs: readonly MessageOf[],
): Promise<Map<string, RunMessage>> {
  if (runs.length === 0) return new Map();
  const clients = await sourceClients(
    ctx,
    runs.map((run) => run.connectionId),
  );
  const read = runs.flatMap((run) => {
    const client = clients.get(run.connectionId);
    return client === undefined ? [] : [readMessage(run, client)];
  });
  return new Map(await Promise.all(read));
}

const query = new URLSearchParams({ format: "metadata" });
for (const name of ["Subject", "From"]) query.append("metadataHeaders", name);

async function readMessage(run: MessageOf, client: SourceClient): Promise<[string, RunMessage]> {
  const unknown = { sourceRef: run.sourceRef, subject: null, from: null, link: null };
  try {
    const path = `${GMAIL}/messages/${encodeURIComponent(run.sourceRef)}?${query.toString()}`;
    const message = await client.get(path, metadataSchema);
    if (message === null) return [run.id, unknown];
    const headers = message.payload?.headers;
    return [
      run.id,
      {
        sourceRef: run.sourceRef,
        subject: headerValue(headers, "Subject") ?? null,
        from: headerValue(headers, "From") ?? null,
        link: gmailLink(client.connection.accountEmail, message.threadId),
      },
    ];
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    return [run.id, unknown];
  }
}
