// Reconnecting: re-authorizing a connection whose Google token was revoked or expired, through
// a Nango reconnect session opened in Connect UI. Nango's `auth` / `override` webhook then
// settles it (lib/reauth.ts).
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { mayManage } from "./disconnect";
import { createReconnectSession } from "./nango";
import { connections } from "./schema";
import { INTEGRATIONS } from "./sources";

/**
 * Starts reconnecting one connection in the caller's org and returns the token Nango's Connect
 * UI opens with. Only whoever may disconnect it may: its owner for a member connection, any
 * admin for an org connection.
 */
export async function startReconnect(ctx: Ctx, connectionId: string): Promise<{ token: string }> {
  const rows = await forOrg(ctx).select(connections, { where: eq(connections.id, connectionId) });
  const connection = rows.at(0);
  if (connection === undefined) throw new NotFoundError("connection");
  if (!mayManage(ctx, connection)) throw new ForbiddenError();
  const token = await createReconnectSession(
    connection.nangoConnectionId,
    INTEGRATIONS[connection.source],
  );
  return { token };
}
