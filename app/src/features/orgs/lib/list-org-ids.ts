import { asc } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { getDb } from "@/db/client";

/**
 * Every org's ID, for scheduled jobs: they then act inside each org as its system ctx
 * (ADR-0009). Nothing a user does reaches this.
 */
export async function listOrgIds(): Promise<string[]> {
  const rows = await getDb()
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.id));
  return rows.map((row) => row.id);
}
