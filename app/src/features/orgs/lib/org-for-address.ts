import { eq, sql } from "drizzle-orm";
import { member, organization, user } from "@/db/auth-schema";
import { getDb } from "@/db/client";

/**
 * The org a mailbox's address belongs to, for a Gmail notification, which names only the
 * address (ADR-0026). First the org of the user whose sign-in address it is, which finds a
 * member connection, a Workspace secondary-domain address included; else the org whose
 * Workspace domain is the address's domain, which finds an org connection. Undefined for an
 * address neither finds. It reads only identity tables, as sign-in does, and returns only the
 * org's ID: the caller then acts inside that org.
 */
export async function findOrgIdForAddress(address: string): Promise<string | undefined> {
  const lowered = address.toLowerCase();
  const db = getDb();
  const users = await db
    .select({ orgId: member.organizationId })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(eq(sql`lower(${user.email})`, lowered))
    .limit(1);
  const viaUser = users.at(0)?.orgId;
  if (viaUser !== undefined) return viaUser;
  const domain = lowered.slice(lowered.lastIndexOf("@") + 1);
  const orgs = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.workspaceDomain, domain));
  return orgs.at(0)?.id;
}
