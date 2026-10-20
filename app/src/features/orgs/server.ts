// The orgs feature: signing in to a Workspace domain's org, the ctx every request runs as, and
// the org's users with their roles (ADR-0002). It is the only feature that touches Better
// Auth's tables.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Ctx } from "@/lib/ctx";
import { getAuth } from "./lib/auth";
import { findCtx } from "./lib/find-ctx";

export { listUsers } from "./lib/list-users";
// Called only by scheduled jobs, which take no ctx until they pick an org.
export { listOrgIds } from "./lib/list-org-ids";
export { getOrgSettings, getWorkspaceDomain } from "./lib/workspace-domain";
export { removeUser, setRole } from "./lib/manage-users";
// Called only by Better Auth's session hook (lib/auth.ts) and tests: it trusts its profile.
export { signIn } from "./lib/sign-in";
// For callers holding a user ID that something trusted vouched for, such as a signed Nango
// webhook. It reads the membership fresh, so a removed user gets undefined.
export { findCtx } from "./lib/find-ctx";

/**
 * The signed-in user's ctx, read fresh from their membership on every request. Pages and Server
 * Actions get ctx from here only. With no session or no org, it redirects to sign-in.
 */
export async function getCtx(): Promise<Ctx> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const ctx = session === null ? undefined : await findCtx(session.user.id);
  if (ctx === undefined) redirect("/sign-in");
  return ctx;
}

/** Better Auth's HTTP endpoints, served from /api/auth. */
export async function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
