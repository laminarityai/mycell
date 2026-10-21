import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ConflictError, ForbiddenError, SpecInvalidError } from "@/lib/errors";
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
    ).rejects.toThrow(
      new ConflictError(
        "The working spec was saved again since you opened it, by another admin or an accepted proposal, so your changes weren't saved. Reload to see the current one.",
      ),
    );

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

describe("editing a working spec by hand", () => {
  it("saves a classify step's new question and check threshold over the revision it was opened at", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    const opened = await getWorkflow(admin, id);
    const [classify, ...rest] = opened.workingSpec.steps;
    const edited = {
      ...opened.workingSpec,
      steps: [{ ...classify, question: "Is this about prices?", checks: { minP: 0.9 } }, ...rest],
    };

    await saveWorkflow(admin, {
      workflowId: id,
      name: opened.name,
      spec: edited,
      baseRevision: opened.revision,
    });

    expect((await getWorkflow(admin, id)).workingSpec.steps[0]).toMatchObject({
      question: "Is this about prices?",
      checks: { minP: 0.9 },
    });
  });

  it("saves a branch's new threshold, the confidence it goes on at", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    const opened = await getWorkflow(admin, id);
    const minP = 0.7;
    const steps = opened.workingSpec.steps.map((step) =>
      step.type === "branch"
        ? {
            ...step,
            paths: step.paths.map((path) => ({
              ...path,
              condition: {
                ...path.condition,
                checks: path.condition.checks.map((check) => ({ ...check, minP })),
              },
            })),
          }
        : step,
    );

    await saveWorkflow(admin, {
      workflowId: id,
      name: opened.name,
      spec: { ...opened.workingSpec, steps },
      baseRevision: opened.revision,
    });

    expect((await getWorkflow(admin, id)).workingSpec.steps[1]).toMatchObject({
      type: "branch",
      paths: [{ condition: { checks: [{ classify: "classify", is: "yes", minP: 0.7 }] } }],
    });
  });

  it("gets an invalid spec's issues at the step and field they're about, and saves nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    const before = await getWorkflow(admin, id);
    const spec = draftSpec();
    const steps = spec.steps as Record<string, unknown>[];
    steps[1] = { ...steps[1], when: { step: "classify", label: "maybe", minP: 0.85 } };

    const checked = await checkWorkflowSpec(admin, spec);

    expect(checked.ok ? [] : checked.issues.map((issue) => issue.path)).toEqual([
      ["steps", 1, "when", "label"],
    ]);
    await expect(
      saveWorkflow(admin, { workflowId: id, name: "Pricing", spec, baseRevision: 1 }),
    ).rejects.toThrow(SpecInvalidError);
    expect(await getWorkflow(admin, id)).toEqual(before);
  });

  it("refuses members a check", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(checkWorkflowSpec(orgA.member.ctx, draftSpec())).rejects.toThrow(ForbiddenError);
  });
});
