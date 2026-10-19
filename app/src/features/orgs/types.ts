import type { Role } from "@/lib/ctx";

/**
 * What Google vouched for at sign-in. `hd` is the ID token's hosted-domain claim, present only
 * for Google Workspace accounts. The `hd` request parameter is just a UI hint and never lands here.
 */
export type VerifiedGoogleProfile = {
  userId: string;
  hd: string | undefined;
};

/** A user of the org, as the org page lists them. */
export type OrgUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};
