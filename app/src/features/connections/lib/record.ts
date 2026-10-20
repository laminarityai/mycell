// Recording a connection once its account passed the checks: the row, a backfilling ingest
// state per ingested app it was granted, and the event that starts its backfill. A Google
// connection replaces the account's one-app connections from before ADR-0014.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { deleteConnection } from "./disconnect";
import { sendConnectionRecorded } from "./events";
import { grantedApps, INTEGRATIONS } from "./google";
import { syncIngestStates } from "./ingest-states";
import { deleteNangoConnection } from "./nango";
import { connectAttempts, connections } from "./schema";

type Attempt = typeof connectAttempts.$inferSelect;

/** What the creation webhook learned about the new connection. */
export type RecordedAccount = {
  nangoConnectionId: string;
  accountEmail: string;
  grantedScopes: string[];
};

/**
 * Records the attempt's connection and settles the attempt. Safe to repeat for a redelivered
 * webhook: the row, its ingest states and the event are each made once.
 */
export async function recordConnection(
  ctx: Ctx,
  attempt: Attempt,
  account: RecordedAccount,
): Promise<void> {
  const inserted = await insertConnection(ctx, attempt, account);
  if (inserted === "refused") return;
  const { id } = inserted;
  if (id !== undefined) {
    await syncIngestStates(ctx, id, grantedApps(attempt.source, account.grantedScopes));
    if (attempt.source === "google") await replaceOneAppConnections(ctx, attempt, account);
    // Sent before the attempt is settled, so a failed send leaves the attempt pending for the
    // redelivery. The event's ID makes Inngest drop a duplicate.
    await sendConnectionRecorded(ctx, id);
  }
  await forOrg(ctx).update(
    connectAttempts,
    { status: "connected" },
    eq(connectAttempts.id, attempt.id),
  );
}

/** Marks the attempt refused, saying why. */
export async function refuse(ctx: Ctx, attempt: Attempt, refusal: string): Promise<void> {
  await forOrg(ctx).update(
    connectAttempts,
    { status: "refused", refusal },
    eq(connectAttempts.id, attempt.id),
  );
}

// The new row's ID, or the ID an earlier delivery of the webhook recorded for this Nango
// connection (undefined if that row is gone again). `refused` when the account is already
// connected: the attempt is then refused.
async function insertConnection(
  ctx: Ctx,
  attempt: Attempt,
  account: RecordedAccount,
): Promise<{ id: string | undefined } | "refused"> {
  const id = randomUUID();
  try {
    await forOrg(ctx).insert(connections, {
      id,
      kind: attempt.kind,
      ownerUserId: attempt.userId,
      source: attempt.source,
      accountEmail: account.accountEmail,
      nangoConnectionId: account.nangoConnectionId,
      grantedScopes: account.grantedScopes,
    });
    return { id };
  } catch (error) {
    // Nango redelivered the webhook after the row was recorded but before the attempt was
    // settled (sending the event failed, say): settle it now, sending the event again.
    if (isUniqueViolation(error, "connections_nango_connection_id_unique")) {
      return { id: await recordedConnectionId(ctx, account.nangoConnectionId) };
    }
    if (isUniqueViolation(error, "connections_org_id_source_account_unique")) {
      await deleteNangoConnection(account.nangoConnectionId, INTEGRATIONS[attempt.source]);
      await refuse(ctx, attempt, `${account.accountEmail} is already connected.`);
      return "refused";
    }
    throw error;
  }
}

async function recordedConnectionId(ctx: Ctx, nangoConnectionId: string) {
  const rows = await forOrg(ctx).select(connections, {
    where: eq(connections.nangoConnectionId, nangoConnectionId),
  });
  return rows.at(0)?.id;
}

// Deletes the account's Gmail and Drive connections of the same kind, and with them every event
// they ingested (invariant 3): the new connection backfills both apps again. A member's are
// their own; an org account's are any admin's, as this one is.
async function replaceOneAppConnections(
  ctx: Ctx,
  attempt: Attempt,
  account: RecordedAccount,
): Promise<void> {
  const replaced = await forOrg(ctx).select(connections, {
    where: and(
      inArray(connections.source, ["gmail", "drive"]),
      eq(connections.kind, attempt.kind),
      eq(connections.accountEmail, account.accountEmail),
      attempt.kind === "member" ? eq(connections.ownerUserId, attempt.userId) : undefined,
    ),
  });
  for (const connection of replaced) await deleteConnection(ctx, connection);
}
