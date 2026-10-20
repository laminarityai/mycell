import { z } from "zod";

/** The sources a connection can reach. Outlook joins after v1, behind the same interface. */
export const sourceSchema = z.enum(["gmail"]);
export type Source = z.infer<typeof sourceSchema>;

/**
 * Whose a connection is: a member connection's data is member-scoped, an org connection's is
 * org-scoped. It becomes the owner scope of everything derived from the connection.
 */
export const connectionKindSchema = z.enum(["member", "org"]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

/**
 * Where a connection's ingest stands: `backfilling` from when it's recorded until its first
 * backfill ends, then `active`, or `failed` if the backfill gave up. `needs_reauth` once Nango
 * reports Google refused to refresh its token: polling skips it until its owner reconnects.
 */
export const connectionStatusSchema = z.enum(["backfilling", "active", "needs_reauth", "failed"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** A connection as its owner sees it. */
export type ConnectionSummary = {
  id: string;
  source: Source;
  kind: ConnectionKind;
  accountEmail: string;
  status: ConnectionStatus;
  // How many messages the current backfill has stored so far.
  backfilledItems: number;
  // When polling last finished for it; null until the first poll.
  lastPolledAt: Date | null;
  createdAt: Date;
};

/**
 * What another feature needs to ingest from a connection: whose it is (its kind becomes the
 * owner scope of everything derived from it) and where its ingest stands.
 */
export type ConnectionDetails = {
  id: string;
  source: Source;
  kind: ConnectionKind;
  ownerUserId: string;
  status: ConnectionStatus;
  cursor: string | null;
};

/** A change to a connection's ingest state; fields left out stay as they are. */
export type IngestStateUpdate = {
  status?: ConnectionStatus;
  backfilledItems?: number;
  cursor?: string;
  lastPolledAt?: Date;
};

/** The user who made a connection, or `removed` once they're no longer a user of the org. */
export type ConnectionOwner =
  { userId: string; removed: false; name: string } | { userId: string; removed: true };

/** An org connection as admins see it. It outlives its owner, so the owner may be removed. */
export type OrgConnectionSummary = ConnectionSummary & { owner: ConnectionOwner };

/**
 * Another member's connection as an admin sees it: who, which source, and its status. Its
 * account address is left out (it is always the owner's sign-in address), and so is anything
 * derived from it: a member connection's data stays the member's (ADR-0001).
 */
export type MemberConnectionMetadata = {
  id: string;
  source: Source;
  status: ConnectionSummary["status"];
  owner: ConnectionOwner;
  createdAt: Date;
};

/** A connect attempt that hasn't become a connection: still waiting, or refused and why. */
export type ConnectAttemptSummary = {
  id: string;
  source: Source;
  kind: ConnectionKind;
  status: "pending" | "refused";
  refusal: string | null;
  createdAt: Date;
};

/**
 * What the connections page shows the caller. `connections` and `attempts` are the caller's
 * own; `orgConnections` and `memberConnections` are filled for admins only.
 */
export type ConnectionsListing = {
  connections: ConnectionSummary[];
  orgConnections: OrgConnectionSummary[];
  memberConnections: MemberConnectionMetadata[];
  attempts: ConnectAttemptSummary[];
};

/** A connection as Nango names it: its connection ID within one integration. */
export type NangoConnectionRef = { nangoConnectionId: string; integration: string };

/** What one reconciliation run did on each side. */
export type ReconciliationSummary = {
  // Mycel's connections Nango no longer has, deleted inside their org with all derived data.
  deletedRows: { orgId: string; connectionId: string }[];
  // Missing from Nango's listing, but kept: asked by ID, Nango still had them or didn't answer.
  keptUnconfirmed: { orgId: string; connectionId: string }[];
  // Nango connections with no Mycel connection, deleted at Nango.
  deletedAtNango: NangoConnectionRef[];
  // Nango connections with no Mycel connection, left alone this run by the bulk-delete rule.
  heldAtNango: NangoConnectionRef[];
};
