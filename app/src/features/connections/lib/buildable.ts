// The connections an admin may build on, read examples from, and try a spec on: their own
// member connections and the org's, granted Gmail. Another member's connection, another
// admin's own included, is never one (ADR-0001), nor is another org's.
import type { Ctx } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ConnectionSummary } from "../types";
import { listConnections } from "./list";

/** Which connections: the caller's own for `member` credentials, the org's for `org`. */
type BuildCredentials = "member" | "org";

/** The caller's own and the org's connections, each pool narrowed to those granted Gmail. */
export function gmailConnections(
  pools: { own: ConnectionSummary[]; org: ConnectionSummary[] },
  credentials?: BuildCredentials,
): ConnectionSummary[] {
  const pool =
    credentials === undefined
      ? [...pools.own, ...pools.org]
      : credentials === "member"
        ? pools.own
        : pools.org;
  return pool.filter((connection) => connection.apps.includes("gmail"));
}

/** The connections the caller may build on, with `credentials`, only those a spec could use. */
export async function buildableConnections(
  ctx: Ctx,
  credentials?: BuildCredentials,
): Promise<ConnectionSummary[]> {
  const listing = await listConnections(ctx);
  return gmailConnections({ own: listing.connections, org: listing.orgConnections }, credentials);
}

/**
 * The connection, when the caller may build on it. NotFoundError for any other member's or
 * another org's; ValidationError, saying why, for one of the wrong kind for `credentials` or
 * not granted Gmail.
 */
export async function requireBuildableConnection(
  ctx: Ctx,
  connectionId: string,
  credentials?: BuildCredentials,
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
  if (!connection.apps.includes("gmail")) {
    throw new ValidationError(`${connection.accountEmail} wasn't granted Gmail.`);
  }
  return connection;
}
