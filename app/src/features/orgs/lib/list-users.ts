import { and, asc, eq } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { roleSchema, type Ctx } from "@/lib/ctx";
import type { OrgUser, UserNames } from "../types";

export async function listUsers(ctx: Ctx): Promise<OrgUser[]> {
  const rows = await getDb()
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name), asc(user.id));
  return rows.map((row) => ({ ...row, role: roleSchema.parse(row.role) }));
}

/** The org's user with this ID; null for someone not in the caller's org. Any role may ask. */
export async function findUser(ctx: Ctx, userId: string): Promise<OrgUser | null> {
  const rows = await getDb()
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)))
    .limit(1);
  const row = rows.at(0);
  return row === undefined ? null : { ...row, role: roleSchema.parse(row.role) };
}

/**
 * The ctx of the org's user with this ID, their role read fresh: how a job acts as a person,
 * such as a connection's owner. Null for someone not in the caller's org. Any role may ask.
 */
export async function userCtx(ctx: Ctx, userId: string): Promise<Ctx | null> {
  const found = await findUser(ctx, userId);
  return found === null ? null : { orgId: ctx.orgId, userId: found.id, role: found.role };
}

/**
 * The org's users' names, as a lookup by user ID. Someone not in the caller's org (a user who
 * has left, or another org's) is "someone no longer in the org". Any role may ask, as for
 * listUsers.
 */
export async function userNames(ctx: Ctx): Promise<UserNames> {
  const names = new Map((await listUsers(ctx)).map((user) => [user.id, user.name]));
  return (userId) => names.get(userId) ?? "someone no longer in the org";
}
