// Drive push (ADR-0026). Each Drive's changes.watch channel posts to /api/google/drive-push when
// the account's changes feed changes: an empty body, with the channel's token and the
// resource's state in headers. A notification is a doorbell, never the delivery: it only starts
// the poll Mycel already has for that connection, which reads what's new from Drive's cursor.
import { getConnection } from "@/features/connections/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { inngest } from "@/lib/inngest";
import { readChannelToken } from "./drive/channel";
import { connectionPollDue } from "./events";
import { drivePushConfig } from "./push-config";

/**
 * Handles one notification from a Drive channel, given its headers. Without DRIVE_PUSH_SECRET
 * it's 404. One whose X-Goog-Channel-Token the secret didn't sign is 401 and starts nothing.
 * Every verified one is 204: a `sync` message (sent when a channel opens) starts nothing, and
 * any other sends `discovery/connection.poll-due` for the connection the token names, as its
 * org's system ctx, if it still exists, its Drive is active and it needs no reconnect.
 */
export async function handleDrivePush(headers: Headers): Promise<{ status: 204 | 401 | 404 }> {
  const config = drivePushConfig();
  if (config === null) return { status: 404 };
  const owner = readChannelToken(config.secret, headers.get("x-goog-channel-token"));
  if (owner === null) return { status: 401 };
  if (headers.get("x-goog-resource-state") === "sync") return { status: 204 };
  const { orgId, connectionId } = owner;
  if (await drivePollable(systemCtx(orgId), connectionId)) {
    await inngest.send(connectionPollDue.create({ orgId, connectionId }));
  }
  return { status: 204 };
}

// Whether the connection still exists, with an active Drive and no reconnect pending.
async function drivePollable(ctx: Ctx, connectionId: string): Promise<boolean> {
  try {
    const connection = await getConnection(ctx, connectionId);
    return !connection.needsReauth && connection.ingest.drive?.status === "active";
  } catch (error) {
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}
