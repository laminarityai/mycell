// The "Try it" message picker: the newest inbox messages across the connections the admin may
// try a spec on, their own and the org's, granted Gmail. Subjects and senders are fetched
// through the proxy for display only, every time, and never stored (invariant 8).
import { z } from "zod";
import { buildableConnections, proxyGet } from "@/features/connections/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { RecentMessages } from "../types";
import { GMAIL } from "./gmail";

/** How many messages the picker offers, across all its connections. */
export const RECENT_LIMIT = 20;

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).default([]),
});
const metadataSchema = z.object({
  id: z.string(),
  // Milliseconds since the epoch, as a string: when Gmail received it.
  internalDate: z.string().default("0"),
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    })
    .default({ headers: [] }),
});

const HEADERS = ["Subject", "From", "Date"];

type Recent = RecentMessages["messages"][number] & { receivedAt: number };

/**
 * The picker's messages, grouped by connection: the newest RECENT_LIMIT of all of them. With
 * `credentials`, only the connections a spec with them could run on: the admin's own for
 * `member`, the org's for `org`.
 */
export async function recentMessages(
  ctx: Ctx,
  credentials?: "member" | "org",
): Promise<RecentMessages[]> {
  requireAdmin(ctx);
  const tryable = await buildableConnections(ctx, credentials);
  // Each connection's newest RECENT_LIMIT holds every one of its messages that can be among
  // the newest RECENT_LIMIT of all.
  const fetched = await Promise.all(
    tryable.map(async (connection) => {
      try {
        return { connection, messages: await newest(ctx, connection.id), unavailable: false };
      } catch {
        // Gmail or Nango refused; the picker says so for this connection alone.
        return { connection, messages: [], unavailable: true };
      }
    }),
  );
  const cutoff = fetched
    .flatMap(({ messages }) => messages.map((message) => message.receivedAt))
    .sort((a, b) => b - a)
    .at(RECENT_LIMIT - 1);
  let left = RECENT_LIMIT;
  return fetched.map(({ connection, messages, unavailable }) => {
    // Ties at the cutoff go to the connections listed first.
    const shown = messages
      .filter((message) => cutoff === undefined || message.receivedAt >= cutoff)
      .slice(0, left);
    left -= shown.length;
    return {
      connectionId: connection.id,
      accountEmail: connection.accountEmail,
      kind: connection.kind,
      messages: shown.map(({ sourceRef, subject, from, date }) => ({
        sourceRef,
        subject,
        from,
        date,
      })),
      unavailable,
    };
  });
}

async function newest(ctx: Ctx, connectionId: string): Promise<Recent[]> {
  const params = new URLSearchParams({ labelIds: "INBOX", maxResults: String(RECENT_LIMIT) });
  const found = await proxyGet(ctx, connectionId, `${GMAIL}/messages?${params}`, listSchema);
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of HEADERS) query.append("metadataHeaders", name);
  const messages = await Promise.all(
    (found?.messages ?? []).map((ref) =>
      proxyGet(
        ctx,
        connectionId,
        `${GMAIL}/messages/${encodeURIComponent(ref.id)}?${query.toString()}`,
        metadataSchema,
      ),
    ),
  );
  return messages
    .flatMap((message) => {
      if (message === null) return [];
      const header = (name: string) =>
        message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
        "";
      return [
        {
          sourceRef: message.id,
          subject: header("Subject"),
          from: header("From"),
          date: header("Date"),
          receivedAt: Number(message.internalDate),
        },
      ];
    })
    .sort((a, b) => b.receivedAt - a.receivedAt);
}
