import { beforeEach, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listOrgIds } from "../server";

beforeEach(resetDatabase);

it("lists every org, for scheduled jobs to visit one at a time", async () => {
  const { orgA, orgB } = await seedTwoOrgs();

  expect(await listOrgIds()).toEqual([orgA.id, orgB.id].sort());
});
