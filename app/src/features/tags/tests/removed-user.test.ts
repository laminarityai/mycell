import { beforeEach, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { removeUser } from "@/features/orgs/server";
import { assignTag, createTag, listTags } from "../server";

beforeEach(resetDatabase);

it("drops a removed user's tag assignments", async () => {
  const { orgA } = await seedTwoOrgs();
  const sales = await createTag(orgA.admin.ctx, "sales");
  await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);
  await assignTag(orgA.admin.ctx, sales.id, orgA.admin.id);

  await removeUser(orgA.admin.ctx, orgA.member.id);

  expect(await listTags(orgA.admin.ctx)).toEqual([
    { id: sales.id, name: "sales", userIds: [orgA.admin.id] },
  ]);
});
