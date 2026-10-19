import { asc, eq } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { roleSchema, type Ctx } from "@/lib/ctx";
import type { OrgUser } from "../types";

export async function listUsers(ctx: Ctx): Promise<OrgUser[]> {
  const rows = await getDb()
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name), asc(user.id));
  return rows.map((row) => ({ ...row, role: roleSchema.parse(row.role) }));
}
