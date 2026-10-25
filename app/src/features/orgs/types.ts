import type { Role } from "@/lib/ctx";

/**
 * What Google vouched for at sign-in. `hd` is the ID token's hosted-domain claim, present only
 * for Google Workspace accounts. The `hd` request parameter is just a UI hint and never lands here.
 */
export type VerifiedGoogleProfile = {
  userId: string;
  hd: string | undefined;
};

/** What an org is called, and the Workspace domain it was created for (ADR-0002). */
export type OrgSettings = {
  name: string;
  workspaceDomain: string;
};

/** A user of the org, as the org page lists them. */
export type OrgUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/**
 * Someone an admin removed from the org, who can't rejoin by signing in until an admin re-adds
 * them. `email` is their address as it was then, trimmed and lowercased; `removedBy` is the
 * admin's user ID, and `removedByName` what to call them.
 */
export type RemovedUser = {
  id: string;
  userId: string;
  email: string;
  removedBy: string;
  removedByName: string;
  removedAt: Date;
};

/** What a user is called wherever Mycel names them, by user ID (`userNames`). */
export type UserNames = (userId: string) => string;
