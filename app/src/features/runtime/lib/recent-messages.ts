// The "Try it" message picker: the newest inbox messages of each connection the admin may try a
// spec on, their own and the org's, granted Gmail. Subjects and senders are fetched through the
// proxy for display only, every time, and never stored (invariant 8).
import { z } from "zod";
import { listConnections, proxyGet } from "@/features/connections/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { RecentMessages } from "../types";
import { GMAIL } from "./gmail";

/** How many messages the picker offers per connection. */
export const RECENT_LIMIT = 20;

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).default([]),
});
const metadataSchema = z.object({
  id: z.string(),
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    })
    .default({ headers: [] }),
});

const HEADERS = ["Subject", "From", "Date"];

/**
 * The picker's messages, per connection. With `credentials`, only the connections a spec with
 * them could run on: the admin's own for `member`, the org's for `org`.
 */
export async function recentMessages(
  ctx: Ctx,
  credentials?: "member" | "org",
): Promise<RecentMessages[]> {
  requireAdmin(ctx);
  const listing = await listConnections(ctx);
  const pool =
    credentials === undefined
      ? [...listing.connections, ...listing.orgConnections]
      : credentials === "member"
        ? listing.connections
        : listing.orgConnections;
  const tryable = pool.filter((connection) => connection.apps.includes("gmail"));
  return Promise.all(
    tryable.map(async (connection) => {
      const base = {
        connectionId: connection.id,
        accountEmail: connection.accountEmail,
        kind: connection.kind,
      };
      try {
        return { ...base, messages: await newest(ctx, connection.id), unavailable: false };
      } catch {
        // Gmail or Nango refused; the picker says so for this connection alone.
        return { ...base, messages: [], unavailable: true };
      }
    }),
  );
}

async function newest(ctx: Ctx, connectionId: string) {
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
  return messages.flatMap((message) => {
    if (message === null) return [];
    const header = (name: string) =>
      message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    return [
      {
        sourceRef: message.id,
        subject: header("Subject"),
        from: header("From"),
        date: header("Date"),
      },
    ];
  });
}
