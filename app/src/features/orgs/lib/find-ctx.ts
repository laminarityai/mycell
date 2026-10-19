import { eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { roleSchema, type Ctx } from "@/lib/ctx";

/** The user's org and current role, read fresh, or undefined if they belong to no org. */
export async function findCtx(userId: string): Promise<Ctx | undefined> {
  const rows = await getDb()
    .select({ orgId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId));
  const row = rows.at(0);
  return row === undefined ? undefined : { ...row, userId, role: roleSchema.parse(row.role) };
}
