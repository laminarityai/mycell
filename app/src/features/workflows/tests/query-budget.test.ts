// Each workflow's latest version is read before every run step and on every page that lists
// workflows, so the read must cost the same however many versions a workflow has.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGmail } from "@/testing/connect-helpers";
import { currentVersionIds, publishWorkflow, saveWorkflow } from "../server";
import { draftSpec } from "./specs";

beforeEach(resetDatabase);

describe("the latest-version read's query budget", () => {
  it("makes one query that returns one row, whether a workflow has 1 version or 10", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    await publishWorkflow(admin, id);

    const one = await countQueries(() => currentVersionIds(admin, [id]));
    let latest = await publishWorkflow(admin, id);
    while (latest.number < 10) latest = await publishWorkflow(admin, id);
    const ten = await countQueries(() => currentVersionIds(admin, [id]));

    expect(one).toEqual({ queries: 1, rows: 1 });
    expect(ten).toEqual(one);
    expect(await currentVersionIds(admin, [id])).toEqual(new Map([[id, latest.id]]));
  });
});
