// The item each run started from, as its connection's readers see it, fetched through the proxy
// for display only (never stored, invariant 8): a Gmail message's subject and sender, and where
// its thread opens in Gmail; or a calendar invite's title and organizer, and where it opens in
// Calendar. The Runs page reads a page of them; a run's page reads its own.
import { CALENDAR_EVENTS } from "@/features/connections/calendar";
import { GMAIL, gmailLink, headerValue, messageSchema } from "@/features/connections/gmail";
import { sourceClients } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import type { TriggerType } from "@/features/spec/triggers";
import type { Ctx } from "@/lib/ctx";
import { z } from "zod";
import type { RunMessage } from "../types";
import { isUnavailable } from "./recent-messages";

/** A run, and what its version's trigger started it from. */
type MessageOf = { id: string; connectionId: string; sourceRef: string; trigger: TriggerType };

const metadataSchema = messageSchema.pick({ id: true, threadId: true, payload: true });

// Only what the Runs page shows of an invite: never its description.
const inviteSchema = z.object({
  summary: z.string().default(""),
  organizer: z.object({ email: z.string().default("") }).optional(),
  htmlLink: z.string().optional(),
});

/**
 * Each run's message or invite, by run ID, for the runs on a connection the caller may read; a
 * run on any other has none. One its app can't give has no subject, sender or link. One query
 * for the connections, then one proxy call a run.
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
    if (client === undefined) return [];
    return [
      run.trigger === "calendar.invite_received"
        ? readInvite(run, client)
        : readMessage(run, client),
    ];
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

// An invite shows as a message does: its title as the subject, its organizer as the sender.
async function readInvite(run: MessageOf, client: SourceClient): Promise<[string, RunMessage]> {
  const unknown = { sourceRef: run.sourceRef, subject: null, from: null, link: null };
  try {
    const fields = new URLSearchParams({ fields: "summary,organizer(email),htmlLink" });
    const path = `${CALENDAR_EVENTS}/${encodeURIComponent(run.sourceRef)}?${fields.toString()}`;
    const invite = await client.get(path, inviteSchema);
    if (invite === null) return [run.id, unknown];
    return [
      run.id,
      {
        sourceRef: run.sourceRef,
        subject: invite.summary,
        from: invite.organizer?.email || null,
        link: invite.htmlLink ?? null,
      },
    ];
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    return [run.id, unknown];
  }
}
