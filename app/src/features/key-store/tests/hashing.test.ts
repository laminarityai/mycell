import { beforeEach, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { fakeKms } from "@/testing/fake-kms";
import { destroyOrgKey, encryptForOrg, hashForOrg } from "../server";

beforeEach(resetDatabase);

const ADDRESS = "sam@client.example";

it("hashes the same text the same way in one company, with a hashing key made on first use", async () => {
  const { orgA } = await seedTwoOrgs();

  const first = await hashForOrg(orgA.admin.ctx, ADDRESS);
  const again = await hashForOrg(systemCtx(orgA.id), ADDRESS);
  const other = await hashForOrg(orgA.member.ctx, "kim@client.example");

  expect(again).toBe(first);
  expect(other).not.toBe(first);
  expect(first).not.toContain("sam");
  expect(first).toMatch(/^[\w-]{43}$/);
  expect(fakeKms.listKeys().map(({ state, aliases }) => ({ state, aliases }))).toEqual([
    { state: "Enabled", aliases: [`alias/mycel/org/${orgA.id}/hash`] },
  ]);
});

it("hashes under each company's own key, apart from its encryption key", async () => {
  const { orgA, orgB } = await seedTwoOrgs();

  const forA = await hashForOrg(orgA.admin.ctx, ADDRESS);
  const forB = await hashForOrg(orgB.admin.ctx, ADDRESS);
  await encryptForOrg(orgA.admin.ctx, "A held send");

  expect(forB).not.toBe(forA);
  expect(fakeKms.listKeys().map(({ aliases }) => aliases)).toEqual([
    [`alias/mycel/org/${orgA.id}/hash`],
    [`alias/mycel/org/${orgB.id}/hash`],
    [`alias/mycel/org/${orgA.id}`],
  ]);
});

it("makes one hashing key for a company when two hashes are its first at once", async () => {
  const { orgA } = await seedTwoOrgs();

  const [first, second] = await Promise.all([
    hashForOrg(orgA.admin.ctx, ADDRESS),
    hashForOrg(orgA.member.ctx, ADDRESS),
  ]);

  expect(second).toBe(first);
  expect(await hashForOrg(orgA.admin.ctx, ADDRESS)).toBe(first);
});

it("destroying a company's keys destroys its hashing key too: nothing hashes the same again", async () => {
  const { orgA, orgB } = await seedTwoOrgs();
  const before = await hashForOrg(orgA.admin.ctx, ADDRESS);
  const forB = await hashForOrg(orgB.admin.ctx, ADDRESS);

  await destroyOrgKey(orgA.admin.ctx);

  expect(fakeKms.listKeys().map(({ state, aliases }) => ({ state, aliases }))).toEqual([
    { state: "PendingDeletion", aliases: [] },
    { state: "Enabled", aliases: [`alias/mycel/org/${orgB.id}/hash`] },
  ]);
  expect(await hashForOrg(orgA.admin.ctx, ADDRESS)).not.toBe(before);
  expect(await hashForOrg(orgB.admin.ctx, ADDRESS)).toBe(forB);
});
