import { asc, eq } from "drizzle-orm";
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

/**
 * The org's users' names, as a lookup by user ID. Someone not in the caller's org (a user who
 * has left, or another org's) is "someone no longer in the org". Any role may ask, as for
 * listUsers.
 */
export async function userNames(ctx: Ctx): Promise<UserNames> {
  const names = new Map((await listUsers(ctx)).map((user) => [user.id, user.name]));
  return (userId) => names.get(userId) ?? "someone no longer in the org";
}
