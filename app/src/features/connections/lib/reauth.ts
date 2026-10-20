// Nango's reports on a connection's credentials. A failed token refresh (`auth` / `refresh`,
// success false) means Google no longer accepts Mycel's access: the connection needs its owner
// to reconnect, and polling skips it. A later successful refresh clears that. A reconnect
// (`override`) clears it too, and re-reads what Google granted: a reconnect can allow an app
// the connection lacked, which then backfills, or leave one out, which it then stops using.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ATTEMPT_TAGS } from "./connect";
import { sendAppsGranted } from "./events";
import { grantedApps, INTEGRATIONS, readAccountEmail } from "./google";
import { dropIngestStates, syncIngestStates } from "./ingest-states";
import { NangoConnectionGoneError, readGrantedScopes } from "./nango";
import { connections } from "./schema";

// The org startConnect tagged the connection with; Nango repeats the tags on every webhook.
const orgTag = z.object({ [ATTEMPT_TAGS.org]: z.string().min(1) });

export type CredentialsWebhook = {
  operation: "refresh" | "override";
  success: boolean;
  connectionId: string;
  providerConfigKey: string;
  tags?: Record<string, string> | undefined;
};

type Connection = typeof connections.$inferSelect;

/**
 * Records what Nango reported about a connection's credentials. Nobody in Mycel is acting, so
 * it runs as the system ctx of the org the signed tags name (ADR-0009), the only org the row
 * can be in. A connection Mycel doesn't have there changes nothing, and so does a failed
 * reconnect: the connection keeps the access it had.
 */
export async function recordCredentials(webhook: CredentialsWebhook): Promise<void> {
  const tags = orgTag.safeParse(webhook.tags);
  if (!tags.success) return;
  const ctx = systemCtx(tags.data[ATTEMPT_TAGS.org]);
  const rows = await forOrg(ctx).select(connections, {
    where: eq(connections.nangoConnectionId, webhook.connectionId),
  });
  const connection = rows.at(0);
  if (connection === undefined || INTEGRATIONS[connection.source] !== webhook.providerConfigKey) {
    return;
  }
  if (webhook.operation === "refresh") {
    await setNeedsReauth(ctx, connection, !webhook.success);
  } else if (webhook.success) {
    await recordReconnect(ctx, connection);
  }
}

async function recordReconnect(ctx: Ctx, connection: Connection): Promise<void> {
  const grant = await readGrant(connection);
  // A reconnect can pick another Google account in the popup. The connection must keep
  // reaching the account it was checked and recorded for, or it keeps waiting on a reconnect.
  if (grant === undefined || grant.accountEmail !== connection.accountEmail) {
    await setNeedsReauth(ctx, connection, true);
    return;
  }
  await forOrg(ctx).update(
    connections,
    { needsReauth: false, grantedScopes: grant.scopes },
    eq(connections.id, connection.id),
  );
  const started = await syncIngestStates(ctx, connection.id, grant.apps);
  if (started.length === 0) return;
  try {
    await sendAppsGranted(ctx, connection.id, started);
  } catch (error) {
    // Nango redelivers the webhook, which starts them again and sends the event then.
    await dropIngestStates(ctx, started);
    throw error;
  }
}

// What the reconnect granted, and the account it reached. Undefined if Nango no longer has the
// connection, or no granted app can say which account it is.
async function readGrant(connection: Connection) {
  try {
    const scopes = await readGrantedScopes(
      connection.nangoConnectionId,
      INTEGRATIONS[connection.source],
    );
    const apps = grantedApps(connection.source, scopes);
    const accountEmail = await readAccountEmail(
      connection.source,
      connection.nangoConnectionId,
      apps,
    );
    return accountEmail === undefined ? undefined : { scopes, apps, accountEmail };
  } catch (error) {
    if (error instanceof NangoConnectionGoneError) return undefined;
    throw error;
  }
}

async function setNeedsReauth(ctx: Ctx, connection: Connection, needsReauth: boolean) {
  if (connection.needsReauth === needsReauth) return;
  await forOrg(ctx).update(connections, { needsReauth }, eq(connections.id, connection.id));
}
