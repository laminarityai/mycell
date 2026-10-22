// Which connection a run reaches another registered app through (ADR-0018). A run starts on a
// Google connection, since its trigger is new Gmail mail; a custom action in Google uses that
// connection, and one in any other app uses the same owner's connection to that app: the run's
// member's own for a member connection, the org's for an org connection.
import { asc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RegisteredAppId } from "../types";
import { isGoogle } from "./apps";
import { isReadableBy } from "./source-access";
import { connections } from "./schema";

/**
 * The connection to `app` a run on `connectionId` uses: that connection itself for Google, or
 * else its owner's connection to the app (the org's, for an org connection), the oldest when
 * there are several. Undefined when there's none. NotFoundError when `connectionId` isn't in the
 * caller's org, ForbiddenError when the caller may not read it.
 */
export async function connectionToApp(
  ctx: Ctx,
  connectionId: string,
  app: RegisteredAppId,
): Promise<string | undefined> {
  const db = forOrg(ctx);
  const run = (await db.select(connections, { where: eq(connections.id, connectionId) })).at(0);
  if (run === undefined) throw new NotFoundError("connection");
  if (!isReadableBy(ctx, run)) throw new ForbiddenError();
  if (app === "google") return isGoogle(run.source) ? run.id : undefined;
  const candidates = await db.select(connections, {
    where: eq(connections.source, app),
    orderBy: [asc(connections.createdAt), asc(connections.id)],
  });
  const match = candidates.find(
    (candidate) =>
      candidate.kind === run.kind &&
      (run.kind === "org" || candidate.ownerUserId === run.ownerUserId),
  );
  return match?.id;
}
