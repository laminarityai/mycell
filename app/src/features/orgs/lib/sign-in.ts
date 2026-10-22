import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { member, organization } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import type { Ctx, Role } from "@/lib/ctx";
import { InvariantError, WorkspaceAccountRequiredError } from "@/lib/errors";
import type { VerifiedGoogleProfile } from "../types";
import { findCtx } from "./find-ctx";

export async function signIn(profile: VerifiedGoogleProfile): Promise<Ctx> {
  if (profile.hd === undefined || profile.hd === "") throw new WorkspaceAccountRequiredError();
  const domain = profile.hd.toLowerCase();
  const existing = await findCtx(profile.userId);
  if (existing !== undefined) return existing;
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(organization)
      .values({
        id: randomUUID(),
        name: domain,
        slug: domain,
        workspaceDomain: domain,
        createdAt: new Date(),
      })
      // No conflict target: the slug is the domain too, and a racing first sign-in can trip
      // its unique constraint before the domain's. Any conflict means the org exists, so this
      // user joins it as a member, found by its domain.
      .onConflictDoNothing()
      .returning({ id: organization.id });
    const created = inserted.at(0);
    const role: Role = created === undefined ? "member" : "admin";
    const orgId = created?.id ?? (await orgIdForDomain(tx, domain));
    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: profile.userId,
      role,
      createdAt: new Date(),
    });
    return { orgId, userId: profile.userId, role };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function orgIdForDomain(tx: Tx, domain: string): Promise<string> {
  const rows = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.workspaceDomain, domain));
  const org = rows.at(0);
  if (org === undefined) throw new InvariantError(`No org for Workspace domain ${domain}`);
  return org.id;
}
