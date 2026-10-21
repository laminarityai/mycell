import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ConflictError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { checkWorkflowSpec, getWorkflow, publishWorkflow, saveWorkflow } from "../server";
import { draftSpec, labelSpec } from "./specs";

beforeEach(resetDatabase);

describe("saving with a base revision", () => {
  it("saves over the revision it was edited from, and moves the revision on", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    expect((await getWorkflow(admin, id)).revision).toBe(1);

    const saved = await saveWorkflow(admin, {
      workflowId: id,
      name: "Pricing",
      spec: labelSpec({ id: "pricing-replies" }),
      baseRevision: 1,
    });

    expect(saved.revision).toBe(2);
    const workflow = await getWorkflow(admin, id);
    expect(workflow.revision).toBe(2);
    expect(workflow.workingSpec.steps.map((step) => step.id)).toEqual(["classify", "label"]);
  });

  it("refuses a stale base revision and leaves the working spec alone", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    // Someone else saves first.
    await saveWorkflow(admin, { workflowId: id, name: "Pricing", spec: draftSpec() });
    const before = await getWorkflow(admin, id);

    await expect(
      saveWorkflow(admin, {
        workflowId: id,
        name: "Pricing",
        spec: labelSpec({ id: "pricing-replies" }),
        baseRevision: 1,
      }),
    ).rejects.toThrow(ConflictError);

    expect(await getWorkflow(admin, id)).toEqual(before);
  });
});

describe("unpublishedChanges", () => {
  it("is set until the working spec is published, and again after an edit", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    expect((await getWorkflow(admin, id)).unpublishedChanges).toBe(true);

    await publishWorkflow(admin, id);
    expect((await getWorkflow(admin, id)).unpublishedChanges).toBe(false);

    await saveWorkflow(admin, { workflowId: id, name: "Pricing", spec: draftSpec() });
    expect((await getWorkflow(admin, id)).unpublishedChanges).toBe(false);
    await saveWorkflow(admin, {
      workflowId: id,
      name: "Pricing",
      spec: labelSpec({ id: "pricing-replies" }),
    });
    expect((await getWorkflow(admin, id)).unpublishedChanges).toBe(true);
  });
});

describe("checkWorkflowSpec", () => {
  it("returns every issue without throwing", async () => {
    const { orgA } = await seedTwoOrgs();

    const checked = await checkWorkflowSpec(orgA.admin.ctx, draftSpec({ autonomy: { rung: 2 } }));

    expect(checked.ok).toBe(false);
    expect(checked.ok ? [] : checked.issues.map((issue) => issue.path.join("."))).toContain(
      "autonomy.rung",
    );
  });

  it("returns what the policy engine made of a valid spec", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);

    const checked = await checkWorkflowSpec(orgA.admin.ctx, draftSpec());

    expect(checked).toMatchObject({
      ok: true,
      maxRisk: "external_send",
      inserted: [{ stepId: "reply-approval", after: "reply" }],
    });
  });
});
