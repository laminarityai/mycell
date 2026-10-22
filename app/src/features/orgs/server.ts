// The orgs feature: signing in to a Workspace domain's org, the ctx every request runs as, and
// the org's users with their roles (ADR-0002). It is the only feature that touches Better
// Auth's tables.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Ctx } from "@/lib/ctx";
import { getAuth } from "./lib/auth";
import { findCtx } from "./lib/find-ctx";

// The org's users, and what to call each one wherever Mycel names them.
export { listUsers, userNames } from "./lib/list-users";
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
 * Actions get ctx from here only. With no session or no org, it redirects to sign-in. React's
 * cache makes it one read per page render, however many of the page's components ask; a Server
 * Action isn't a render, so each call there reads afresh.
 */
export const getCtx = cache(async (): Promise<Ctx> => {
  const ctx = await findSessionCtx();
  if (ctx === undefined) redirect("/sign-in");
  return ctx;
});

/**
 * The signed-in user's ctx, or undefined with no session or no org. For route handlers, which
 * answer a fetch with a status instead of redirecting it.
 */
export async function findSessionCtx(): Promise<Ctx | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session === null ? undefined : findCtx(session.user.id);
}

/** Better Auth's HTTP endpoints, served from /api/auth. */
export async function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
