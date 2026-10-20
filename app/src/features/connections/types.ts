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

/** A connection as its owner sees it. */
export type ConnectionSummary = {
  id: string;
  source: Source;
  kind: ConnectionKind;
  accountEmail: string;
  status: "active";
  createdAt: Date;
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
