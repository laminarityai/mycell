// Each workflow's monthly budget, as the Credits page shows spending against it: the latest
// published version's, not an unpublished edit's.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ForbiddenError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { archiveWorkflow, listWorkflowBudgets, publishWorkflow, saveWorkflow } from "../server";
import { draftSpec, labelSpec } from "./specs";

beforeEach(resetDatabase);

describe("listWorkflowBudgets", () => {
  it("gives each workflow its latest published version's budget, by name", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const quotes = await saveWorkflow(admin, {
      name: "Quote replies",
      spec: draftSpec({ budget: { monthlyCredits: 500 } }),
    });
    await publishWorkflow(admin, quotes.id);
    // Raised in the editor, not yet published: the version's budget still holds.
    await saveWorkflow(admin, {
      workflowId: quotes.id,
      name: "Quote replies",
      spec: draftSpec({ budget: { monthlyCredits: 900 } }),
    });
    const labels = await saveWorkflow(admin, { name: "Labels", spec: labelSpec() });
    await publishWorkflow(admin, labels.id);
    await archiveWorkflow(admin, labels.id);
    const draft = await saveWorkflow(admin, {
      name: "Draft",
      spec: labelSpec({ id: "draft", budget: { monthlyCredits: 50 } }),
    });

    expect(await listWorkflowBudgets(admin)).toEqual([
      { id: draft.id, name: "Draft", archived: false, monthlyCredits: null },
      { id: labels.id, name: "Labels", archived: true, monthlyCredits: null },
      { id: quotes.id, name: "Quote replies", archived: false, monthlyCredits: 500 },
    ]);
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listWorkflowBudgets(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });

  it("reads 1 workflow or 20 in the same two queries", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const publish = async (n: number) => {
      const spec = labelSpec({ id: `labels-${String(n)}`, budget: { monthlyCredits: 100 } });
      const { id } = await saveWorkflow(admin, { name: `Labels ${String(n)}`, spec });
      await publishWorkflow(admin, id);
    };
    await publish(0);
    const one = await countQueries(() => listWorkflowBudgets(admin));
    for (let n = 1; n < 20; n += 1) await publish(n);
    const twenty = await countQueries(() => listWorkflowBudgets(admin));

    expect(one.queries).toBe(2);
    expect(twenty.queries).toBe(one.queries);
  });
});
