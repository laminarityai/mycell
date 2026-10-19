import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { member, organization } from "../auth-schema";
import { getDb } from "../client";
import { resetDatabase } from "../testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "../testing/two-org-fixture";

let orgs: TwoOrgs;

beforeEach(async () => {
  await resetDatabase();
  orgs = await seedTwoOrgs();
});

describe("the two-org fixture", () => {
  it("seeds org A and org B, each with an admin and a member", async () => {
    const rows = await getDb()
      .select({ orgId: member.organizationId, userId: member.userId, role: member.role })
      .from(member);

    expect(rows).toHaveLength(4);
    for (const org of [orgs.orgA, orgs.orgB]) {
      expect(org.admin.ctx).toEqual({ orgId: org.id, userId: org.admin.id, role: "admin" });
      expect(org.member.ctx).toEqual({ orgId: org.id, userId: org.member.id, role: "member" });
      expect(rows).toContainEqual({ orgId: org.id, userId: org.admin.id, role: "admin" });
      expect(rows).toContainEqual({ orgId: org.id, userId: org.member.id, role: "member" });
    }
  });
});

describe("Better Auth's schema", () => {
  it("lets a user belong to at most one org", async () => {
    const joinOrgB = getDb().insert(member).values({
      id: randomUUID(),
      organizationId: orgs.orgB.id,
      userId: orgs.orgA.member.id,
      role: "member",
      createdAt: new Date(),
    });

    await expect(joinOrgB).rejects.toThrow();
    const memberships = await getDb()
      .select()
      .from(member)
      .where(eq(member.userId, orgs.orgA.member.id));
    expect(memberships.map((row) => row.organizationId)).toEqual([orgs.orgA.id]);
  });

  it("gives each Workspace domain at most one org", async () => {
    const duplicate = getDb().insert(organization).values({
      id: randomUUID(),
      name: "Org A again",
      slug: "org-a-again",
      workspaceDomain: orgs.orgA.workspaceDomain,
      createdAt: new Date(),
    });

    await expect(duplicate).rejects.toThrow();
  });
});
