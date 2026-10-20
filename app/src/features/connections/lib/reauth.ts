// Nango's reports on a connection's credentials. A failed token refresh (`auth` / `refresh`,
// success false) means Google no longer accepts Mycel's access: the connection needs its owner
// to reconnect, and polling skips it. A later successful refresh, or a reconnect (`override`),
// makes it active again.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { systemCtx } from "@/lib/ctx";
import { ATTEMPT_TAGS } from "./connect";
import { NangoConnectionGoneError } from "./nango";
import { connections } from "./schema";
import { INTEGRATIONS, readAccountEmail } from "./sources";

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
 * can be in. A connection Mycel doesn't have there changes nothing.
 */
export async function recordCredentials(webhook: CredentialsWebhook): Promise<void> {
  const tags = orgTag.safeParse(webhook.tags);
  if (!tags.success) return;
  const db = forOrg(systemCtx(tags.data[ATTEMPT_TAGS.org]));
  const rows = await db.select(connections, {
    where: eq(connections.nangoConnectionId, webhook.connectionId),
  });
  const connection = rows.at(0);
  if (connection === undefined || INTEGRATIONS[connection.source] !== webhook.providerConfigKey) {
    return;
  }
  const status = await statusAfter(webhook, connection);
  if (status !== connection.status) {
    await db.update(connections, { status }, eq(connections.id, connection.id));
  }
}

async function statusAfter(
  webhook: CredentialsWebhook,
  connection: Connection,
): Promise<Connection["status"]> {
  if (webhook.operation === "refresh" && !webhook.success) return "needs_reauth";
  // Only a connection waiting on its credentials comes back; others keep their ingest state.
  if (!webhook.success || connection.status !== "needs_reauth") return connection.status;
  if (webhook.operation === "override" && !(await sameAccount(connection))) {
    return "needs_reauth";
  }
  return "active";
}

// A reconnect can pick another Google account in the popup. The connection must keep reaching
// the account it was checked and recorded for, or it stays waiting on a reconnect.
async function sameAccount(connection: Connection): Promise<boolean> {
  try {
    const email = await readAccountEmail(connection.source, connection.nangoConnectionId);
    return email === connection.accountEmail;
  } catch (error) {
    if (error instanceof NangoConnectionGoneError) return false;
    throw error;
  }
}
