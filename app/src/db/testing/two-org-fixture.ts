// The shared two-org fixture: org A and org B, each with an admin and a member, and a ctx
// for each user. Every isolation test starts from it.
import { randomUUID } from "node:crypto";
import { grantCredits } from "@/features/credits/server";
import { type Ctx, type Role, systemCtx } from "@/lib/ctx";
import { member, organization, user } from "../auth-schema";
import { getDb } from "../client";

export type FixtureUser = { id: string; email: string; ctx: Ctx };

export type FixtureOrg = {
  id: string;
  workspaceDomain: string;
  admin: FixtureUser;
  member: FixtureUser;
};

export type TwoOrgs = { orgA: FixtureOrg; orgB: FixtureOrg };

/** What a test asks of the two orgs. */
export type TwoOrgsOptions = {
  /**
   * Credits granted to each org. A zero balance pauses every workflow (no run starts), so a test
   * whose workflows must run asks for some; one about the balance itself starts from none.
   */
  credits?: number;
};

/** The credits a test that needs its workflows to run grants each org: more than any run costs. */
export const FUNDED_CREDITS = 1000;

export async function seedTwoOrgs({ credits = 0 }: TwoOrgsOptions = {}): Promise<TwoOrgs> {
  const orgs = { orgA: await seedOrg("a"), orgB: await seedOrg("b") };
  if (credits > 0) {
    await grantCredits(systemCtx(orgs.orgA.id), credits);
    await grantCredits(systemCtx(orgs.orgB.id), credits);
  }
  return orgs;
}

async function seedOrg(letter: "a" | "b"): Promise<FixtureOrg> {
  const workspaceDomain = `org-${letter}.test`;
  const orgId = randomUUID();
  await getDb()
    .insert(organization)
    .values({
      id: orgId,
      name: `Org ${letter.toUpperCase()}`,
      slug: `org-${letter}`,
      workspaceDomain,
      createdAt: new Date(),
    });
  return {
    id: orgId,
    workspaceDomain,
    admin: await seedUser(orgId, `admin@${workspaceDomain}`, "admin"),
    member: await seedUser(orgId, `member@${workspaceDomain}`, "member"),
  };
}

/** One more user in a seeded org, for a test that needs a second admin or member. */
export async function seedUser(orgId: string, email: string, role: Role): Promise<FixtureUser> {
  const db = getDb();
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name: email, email, emailVerified: true });
  await db
    .insert(member)
    .values({ id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() });
  return { id: userId, email, ctx: { orgId, userId, role } };
}
