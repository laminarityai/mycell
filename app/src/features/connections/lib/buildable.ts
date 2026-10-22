// The connections an admin may build on, read examples from, and try a spec on: their own
// member connections and the org's, granted the app the spec's trigger watches (Gmail, unless
// it says otherwise). Another member's connection, another admin's own included, is never one
// (ADR-0001), nor is another org's.
import type { Ctx } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ConnectionSummary, GoogleApp } from "../types";
import { APP_NAMES } from "./source-names";
import { listConnections } from "./list";

/** Which connections: the caller's own for `member` credentials, the org's for `org`. */
type BuildCredentials = "member" | "org";

/** The caller's own and the org's connections, each pool narrowed to those granted Gmail. */
export function gmailConnections(
  pools: { own: ConnectionSummary[]; org: ConnectionSummary[] },
  credentials?: BuildCredentials,
): ConnectionSummary[] {
  return connectionsGranted(pools, "gmail", credentials);
}

/** The caller's own and the org's connections, each pool narrowed to those granted `app`. */
export function connectionsGranted(
  pools: { own: ConnectionSummary[]; org: ConnectionSummary[] },
  app: GoogleApp,
  credentials?: BuildCredentials,
): ConnectionSummary[] {
  const pool =
    credentials === undefined
      ? [...pools.own, ...pools.org]
      : credentials === "member"
        ? pools.own
        : pools.org;
  return pool.filter((connection) => connection.apps.includes(app));
}

/**
 * The connections the caller may build on, with `credentials`, only those a spec could use:
 * granted `app`, the one its trigger watches.
 */
export async function buildableConnections(
  ctx: Ctx,
  credentials?: BuildCredentials,
  app: GoogleApp = "gmail",
): Promise<ConnectionSummary[]> {
  const listing = await listConnections(ctx);
  const pools = { own: listing.connections, org: listing.orgConnections };
  return connectionsGranted(pools, app, credentials);
}

/**
 * The connection, when the caller may build on it. NotFoundError for any other member's or
 * another org's; ValidationError, saying why, for one of the wrong kind for `credentials` or
 * not granted `app` (Gmail, unless the spec's trigger watches another).
 */
export async function requireBuildableConnection(
  ctx: Ctx,
  connectionId: string,
  credentials?: BuildCredentials,
  app: GoogleApp = "gmail",
): Promise<ConnectionSummary> {
  const listing = await listConnections(ctx);
  const own = listing.connections.find(({ id }) => id === connectionId);
  const connection = own ?? listing.orgConnections.find(({ id }) => id === connectionId);
  if (connection === undefined) throw new NotFoundError("connection");
  if (credentials !== undefined && (credentials === "member") !== (own !== undefined)) {
    throw new ValidationError(
      credentials === "member"
        ? "This workflow uses member credentials: try it on your own connection."
        : "This workflow uses org credentials: try it on an org connection.",
    );
  }
  if (!connection.apps.includes(app)) {
    throw new ValidationError(`${connection.accountEmail} wasn't granted ${APP_NAMES[app]}.`);
  }
  return connection;
}
