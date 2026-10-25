import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { changeUserEmail, recreateUser } from "@/db/testing/seed-user";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { ForbiddenError, NotFoundError, RemovedFromOrgError } from "@/lib/errors";
import { listRemovedUsers, listUsers, reAddUser, removeUser, signIn } from "../server";

beforeEach(resetDatabase);

type Ctx = Parameters<typeof listUsers>[0];

const userIds = async (ctx: Ctx) => (await listUsers(ctx)).map((u) => u.id).sort();

// The ID of the org's one removal, as an admin sees it.
const onlyRemovalId = async (adminCtx: Ctx) => {
  const removed = await listRemovedUsers(adminCtx);
  expect(removed).toHaveLength(1);
  return removed[0]?.id ?? "";
};

describe("removeUser", () => {
  it("records who was removed, their address, who removed them and when", async () => {
    const { orgA } = await seedTwoOrgs();
    const before = new Date();

    await removeUser(orgA.admin.ctx, orgA.member.id);

    const removed = await listRemovedUsers(orgA.admin.ctx);
    expect(removed).toEqual([
      {
        id: expect.any(String) as string,
        userId: orgA.member.id,
        email: orgA.member.email,
        removedBy: orgA.admin.id,
        removedByName: orgA.admin.email,
        removedAt: expect.any(Date) as Date,
      },
    ]);
    expect(removed[0]?.removedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("records the address normalized: trimmed and lowercased", async () => {
    const { orgA } = await seedTwoOrgs();
    const ada = await seedUser(orgA.id, " Ada@Org-A.TEST ", "member");

    await removeUser(orgA.admin.ctx, ada.id);

    expect((await listRemovedUsers(orgA.admin.ctx)).map((r) => r.email)).toEqual([
      "ada@org-a.test",
    ]);
  });
});

describe("signIn after a removal", () => {
  it("refuses the removed user, matched by their user ID, even under a new address", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);
    await changeUserEmail(orgA.member.id, `renamed@${orgA.workspaceDomain}`);

    await expect(signIn({ userId: orgA.member.id, hd: orgA.workspaceDomain })).rejects.toThrow(
      RemovedFromOrgError,
    );
    expect(await userIds(orgA.admin.ctx)).toEqual([orgA.admin.id]);
  });

  it("refuses a re-created account with a new user ID, matched by its address in any case", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);
    const recreated = await recreateUser(orgA.member.id, orgA.member.email.toUpperCase());

    await expect(signIn({ userId: recreated.id, hd: orgA.workspaceDomain })).rejects.toThrow(
      RemovedFromOrgError,
    );
    expect(await userIds(orgA.admin.ctx)).toEqual([orgA.admin.id]);
  });

  it("still lets everyone else in the domain join", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);
    const { id } = await recreateUser(orgA.member.id, `someone-else@${orgA.workspaceDomain}`);

    const ctx = await signIn({ userId: id, hd: orgA.workspaceDomain });

    expect(ctx).toEqual({ orgId: orgA.id, userId: id, role: "member" });
  });
});

describe("reAddUser", () => {
  it("lifts the block: the person joins as a member at their next sign-in", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);

    await reAddUser(orgA.admin.ctx, await onlyRemovalId(orgA.admin.ctx));

    expect(await listRemovedUsers(orgA.admin.ctx)).toEqual([]);
    expect(await signIn({ userId: orgA.member.id, hd: orgA.workspaceDomain })).toEqual(
      orgA.member.ctx,
    );
  });

  it("lifts it for a re-created account too", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);
    const recreated = await recreateUser(orgA.member.id, orgA.member.email);

    await reAddUser(orgA.admin.ctx, await onlyRemovalId(orgA.admin.ctx));

    expect(await signIn({ userId: recreated.id, hd: orgA.workspaceDomain })).toMatchObject({
      orgId: orgA.id,
      role: "member",
    });
  });

  it("refuses a member, keeping the block", async () => {
    const { orgA } = await seedTwoOrgs();
    const other = await seedUser(orgA.id, `other@${orgA.workspaceDomain}`, "member");
    await removeUser(orgA.admin.ctx, other.id);
    const removalId = await onlyRemovalId(orgA.admin.ctx);

    await expect(reAddUser(orgA.member.ctx, removalId)).rejects.toThrow(ForbiddenError);
    await expect(signIn({ userId: other.id, hd: orgA.workspaceDomain })).rejects.toThrow(
      RemovedFromOrgError,
    );
  });

  it("treats a removal that doesn't exist as not found", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(reAddUser(orgA.admin.ctx, crypto.randomUUID())).rejects.toThrow(NotFoundError);
  });
});

describe("listRemovedUsers", () => {
  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listRemovedUsers(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });

  it("makes the same number of queries for one removal or several", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);
    const one = await countQueries(() => listRemovedUsers(orgA.admin.ctx));
    for (const name of ["b", "c", "d"]) {
      const extra = await seedUser(orgA.id, `${name}@${orgA.workspaceDomain}`, "member");
      await removeUser(orgA.admin.ctx, extra.id);
    }

    const several = await countQueries(() => listRemovedUsers(orgA.admin.ctx));

    expect(several.queries).toBe(one.queries);
  });
});
