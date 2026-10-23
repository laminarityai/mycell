// Which Google accounts a connect attempt may reach, checked before a connection is recorded.
import { getWorkspaceDomain, listUsers } from "@/features/orgs/server";
import { type Ctx, isAdmin } from "@/lib/ctx";
import type { ConnectionKind } from "../types";

/**
 * Why the account can't be connected by this attempt, or undefined if it can. A member
 * connection must reach the caller's own sign-in address. An org connection must reach an
 * address in the org's Workspace domain, and its maker must still be an admin.
 */
export async function checkAccount(
  ctx: Ctx,
  kind: ConnectionKind,
  accountEmail: string,
): Promise<string | undefined> {
  return kind === "org" ? checkOrgAccount(ctx, accountEmail) : checkOwnAccount(ctx, accountEmail);
}

async function checkOwnAccount(ctx: Ctx, accountEmail: string): Promise<string | undefined> {
  const users = await listUsers(ctx);
  const me = users.find((user) => user.id === ctx.userId);
  if (me?.email.toLowerCase() !== accountEmail) {
    return `You can only connect your own account (${me?.email ?? "your sign-in address"}), not ${accountEmail}.`;
  }
  return undefined;
}

async function checkOrgAccount(ctx: Ctx, accountEmail: string): Promise<string | undefined> {
  // The role is read fresh with the webhook's ctx: an admin demoted mid-connect can't finish.
  if (!isAdmin(ctx)) return "Only admins can connect org sources.";
  const domain = (await getWorkspaceDomain(ctx)).toLowerCase();
  if (accountEmail.slice(accountEmail.lastIndexOf("@") + 1) !== domain) {
    return `An org connection must be an @${domain} account, not ${accountEmail}.`;
  }
  return undefined;
}
