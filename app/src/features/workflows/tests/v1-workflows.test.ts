import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedV1Workflow, storedWorkingSpec } from "@/db/testing/seed-workflow";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { eachStep } from "@/features/spec/tree";
import type { Spec } from "@/features/spec/types";
import { upgradeSpec } from "@/features/spec/upgrade";
import { specV1Schema, type SpecV1 } from "@/features/spec/v1";
import { validateSpec } from "@/features/spec/validate";
import { InvariantError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { getWorkflow, getWorkflowVersion, publishWorkflow, saveWorkflow } from "../server";
import { draftSpec, labelSpec, sheetSpec } from "./specs";

beforeEach(resetDatabase);

/** A v1 spec as saving parsed it back then. */
const v1 = (raw: unknown): SpecV1 => specV1Schema.parse(raw);

const stepIds = (spec: Spec) => eachStep(spec).map(({ step }) => step.id);

/** The draft spec as it was published under v1: the policy's approval right after the draft. */
function publishedV1() {
  const working = v1(draftSpec());
  const approval = { id: "reply-approval", type: "approval", channel: "gmail_drafts" } as const;
  return {
    spec: { ...working, steps: [...working.steps, approval] },
    maxRisk: "external_send",
    requiredActions: ["google-mail.create-draft"],
  };
}

async function adminWithV1Workflow(published?: ReturnType<typeof publishedV1>) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  const seeded = await seedV1Workflow({
    orgId: orgA.id,
    createdBy: orgA.admin.id,
    name: "Pricing",
    workingSpec: v1(draftSpec()),
    published,
  });
  return { admin, ...seeded };
}

describe("this suite's v1 fixtures", () => {
  it("each upgrade to a valid v2 spec with the same step IDs, and once is enough", () => {
    for (const raw of [draftSpec(), labelSpec(), sheetSpec()]) {
      const spec = upgradeSpec(v1(raw));

      expect(validateSpec(spec)).toEqual({ ok: true, spec });
      expect(stepIds(spec)).toEqual(v1(raw).steps.map((step) => step.id));
      expect(upgradeSpec(spec)).toEqual(spec);
    }
  });
});

describe("a workflow saved before branches had paths", () => {
  it("reads its v1 working spec back as v2, with the same step IDs", async () => {
    const { admin, workflowId } = await adminWithV1Workflow();

    const { workingSpec } = await getWorkflow(admin, workflowId);

    expect(workingSpec.specVersion).toBe(2);
    expect(stepIds(workingSpec)).toEqual(["classify", "gate", "reply"]);
    expect(workingSpec).toEqual(upgradeSpec(v1(draftSpec())));
  });

  it("shows no unpublished changes while nobody has touched it", async () => {
    const { admin, workflowId } = await adminWithV1Workflow(publishedV1());

    const workflow = await getWorkflow(admin, workflowId);

    expect(workflow.unpublishedChanges).toBe(false);
    expect(workflow.inserted).toEqual([
      { stepId: "reply-approval", after: "reply", action: "google-mail.create-draft" },
    ]);
  });

  it("reads its v1 version back as v2, with the same step IDs", async () => {
    const { admin, versionId } = await adminWithV1Workflow(publishedV1());

    const { spec } = await getWorkflowVersion(admin, versionId ?? "");

    expect(spec.specVersion).toBe(2);
    expect(stepIds(spec)).toEqual(["classify", "gate", "reply", "reply-approval"]);
  });

  it("is written as v2 when it's saved, from what was read or from v1 input", async () => {
    const { admin, workflowId } = await adminWithV1Workflow(publishedV1());
    const opened = await getWorkflow(admin, workflowId);

    await saveWorkflow(admin, {
      workflowId,
      name: opened.name,
      spec: opened.workingSpec,
      baseRevision: opened.revision,
    });

    expect(await storedWorkingSpec(workflowId)).toEqual(opened.workingSpec);
    expect((await getWorkflow(admin, workflowId)).unpublishedChanges).toBe(false);

    await saveWorkflow(admin, { workflowId, name: "Pricing", spec: labelSpec() });
    expect(await storedWorkingSpec(workflowId)).toMatchObject({ specVersion: 2 });
  });

  it("publishes a v2 version once saved", async () => {
    const { admin, workflowId } = await adminWithV1Workflow(publishedV1());
    await saveWorkflow(admin, { workflowId, name: "Pricing", spec: draftSpec() });

    await publishWorkflow(admin, workflowId);

    const latest = (await getWorkflow(admin, workflowId)).versions.at(0);
    const { spec } = await getWorkflowVersion(admin, latest?.id ?? "");
    expect(stepIds(spec)).toEqual(["classify", "gate", "reply", "reply-approval"]);
  });
});

describe("a stored spec in neither version's shape", () => {
  it("fails as it's read, with InvariantError", async () => {
    const { orgA } = await seedTwoOrgs();
    const { workflowId } = await seedV1Workflow({
      orgId: orgA.id,
      createdBy: orgA.admin.id,
      // Saving never let a spec with no steps through.
      workingSpec: { ...v1(draftSpec()), steps: [] },
    });

    await expect(getWorkflow(orgA.admin.ctx, workflowId)).rejects.toBeInstanceOf(InvariantError);
  });
});
