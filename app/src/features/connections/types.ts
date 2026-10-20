import { z } from "zod";

/**
 * What a connection reaches. `google` is one Google account, with every Google app it allows
 * (ADR-0014). `gmail` and `drive` are the one-app connections made before that: nothing makes
 * them any more, and connecting Google for their account replaces them. Outlook joins after v1.
 */
export const sourceSchema = z.enum(["google", "gmail", "drive"]);
export type Source = z.infer<typeof sourceSchema>;

/** The Google apps a Google connection asks for, in the order the UI lists them. */
export const googleAppSchema = z.enum(["gmail", "drive", "sheets", "calendar", "docs", "tasks"]);
export type GoogleApp = z.infer<typeof googleAppSchema>;

/**
 * The scope a Google connection asks for each app. Google lets people untick apps on the
 * consent screen, so a connection may be granted only some of them.
 */
export const GOOGLE_APP_SCOPES: Record<GoogleApp, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  drive: "https://www.googleapis.com/auth/drive.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  docs: "https://www.googleapis.com/auth/documents",
  tasks: "https://www.googleapis.com/auth/tasks",
};

/** The apps discovery ingests from. Each has its own backfill, cursor and poll. */
export const ingestedAppSchema = z.enum(["gmail", "drive"]);
export type IngestedApp = z.infer<typeof ingestedAppSchema>;

/**
 * Whose a connection is: a member connection's data is member-scoped, an org connection's is
 * org-scoped. It becomes the owner scope of everything derived from the connection.
 */
export const connectionKindSchema = z.enum(["member", "org"]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

/**
 * Where one app's ingest stands: `backfilling` from when the app is granted until its first
 * backfill ends, then `active`, or `failed` if the backfill gave up.
 */
export const ingestStatusSchema = z.enum(["backfilling", "active", "failed"]);
export type IngestStatus = z.infer<typeof ingestStatusSchema>;

/**
 * Where a connection stands as a whole: `needs_reauth` once Nango reports Google refused to
 * refresh its token (polling skips it until its owner reconnects), and otherwise the furthest
 * behind of its apps' ingest statuses: `failed`, then `backfilling`, then `active`.
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
  // The OAuth scopes Google granted it, as full scope URLs, as of its last connect or
  // reconnect. Empty for a one-app connection not reconnected since ADR-0014.
  grantedScopes: string[];
  // The apps it may use, and the ones a Google connection asks for but wasn't granted (none
  // for a one-app connection from before ADR-0014).
  apps: GoogleApp[];
  missingApps: GoogleApp[];
  // How many messages and file changes its current backfills have stored so far.
  backfilledItems: number;
  // When polling last finished for any of its apps; null until the first poll.
  lastPolledAt: Date | null;
  createdAt: Date;
};

/** Where one ingested app stands on a connection. */
export type AppIngestState = {
  status: IngestStatus;
  // Where polling resumes: Gmail's history ID, or Drive's changes page token. Null until the
  // app's backfill starts.
  cursor: string | null;
  backfilledItems: number;
  lastPolledAt: Date | null;
};

/**
 * What another feature needs to ingest from a connection: whose it is (its kind becomes the
 * owner scope of everything derived from it), what it was granted, and where each ingested
 * app stands. `ingest` holds exactly the ingested apps the connection may use.
 */
export type ConnectionDetails = {
  id: string;
  source: Source;
  kind: ConnectionKind;
  ownerUserId: string;
  needsReauth: boolean;
  grantedScopes: string[];
  apps: GoogleApp[];
  ingest: Partial<Record<IngestedApp, AppIngestState>>;
};

/** A change to one app's ingest state; fields left out stay as they are. */
export type IngestStateUpdate = {
  status?: IngestStatus;
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
 * Another member's connection as an admin sees it: who, which apps, and its status. Its
 * account address is left out (it is always the owner's sign-in address), and so is anything
 * derived from it: a member connection's data stays the member's (ADR-0001).
 */
export type MemberConnectionMetadata = {
  id: string;
  source: Source;
  apps: GoogleApp[];
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

/**
 * The source refused a proxied request (anything but a 404 or 410, which read as "no such
 * item"). It carries the source's status and parsed error body, so a connector can tell a
 * refusal it recovers from (Drive's invalid page token) from a failure.
 */
export class SourceRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    path: string,
  ) {
    super(`Nango proxy ${path} failed: ${String(status)}`);
    this.name = "SourceRequestError";
  }
}
