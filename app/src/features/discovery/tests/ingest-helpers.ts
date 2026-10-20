import { handleNangoWebhook, listConnections, startConnect } from "@/features/connections/server";
import type { ConnectionKind } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { fakeNango } from "@/testing/fake-nango";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A moment `days` days ago. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Connects `emailAddress`'s Gmail through the whole connect flow (as a member connection, or
 * an org connection for an admin), seeds its mailbox with `messages`, and returns Mycel's
 * connection ID, Nango's, and the fake mailbox.
 */
export async function connectMailbox(
  ctx: Ctx,
  emailAddress: string,
  messages: FakeMessageInput[] = [],
  kind: ConnectionKind = "member",
) {
  const { token } = await startConnect(ctx, "gmail", kind);
  const webhook = fakeNango.completeConnect(token, { emailAddress });
  await handleNangoWebhook(webhook.rawBody, webhook.headers);
  const listing = await listConnections(ctx);
  const connection = [...listing.connections, ...listing.orgConnections].find(
    (c) => c.accountEmail === emailAddress,
  );
  if (connection === undefined) throw new Error(`${emailAddress} didn't connect`);
  const mailbox = fakeNango.mailbox(webhook.connectionId);
  for (const message of messages) mailbox.add(message);
  return { id: connection.id, nangoConnectionId: webhook.connectionId, mailbox };
}

/** The caller's own connection with this ID, as the connections page lists it. */
export async function listed(ctx: Ctx, connectionId: string) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections].find((c) => c.id === connectionId);
}
