import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { findStep } from "@/features/spec/tree";
import { connectGmail } from "@/testing/connect-helpers";
import { getWorkflow, getWorkflowVersion, publishWorkflow, saveWorkflow } from "../server";
import { triageSpec } from "./specs";

beforeEach(resetDatabase);

describe("a workflow whose branch has several paths", () => {
  it("saves and publishes from JSON, with the review on the pricing path", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);

    const spec = JSON.parse(JSON.stringify(triageSpec())) as unknown;
    const saved = await saveWorkflow(admin, { name: "Triage", spec });
    await publishWorkflow(admin, saved.id);

    expect(saved).toMatchObject({
      maxRisk: "external_send",
      inserted: [{ stepId: "reply-approval", after: "reply" }],
    });
    const workflow = await getWorkflow(admin, saved.id);
    expect(workflow.unpublishedChanges).toBe(false);
    const latest = workflow.versions.at(0);
    if (latest === undefined) throw new Error("not published");
    const route = findStep((await getWorkflowVersion(admin, latest.id)).spec, "route");
    if (route?.type !== "branch") throw new Error("no branch");
    expect(route.paths.map((path) => path.steps.map((step) => step.id))).toEqual([
      ["to-person"],
      ["reply", "reply-approval"],
    ]);
    expect(route.otherwise.steps).toEqual([]);
  });
});
