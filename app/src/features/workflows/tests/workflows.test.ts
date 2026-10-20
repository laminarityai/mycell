import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect, listConnections } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, SpecInvalidError, ValidationError } from "@/lib/errors";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import {
  getWorkflow,
  getWorkflowVersion,
  listWorkflows,
  publishWorkflow,
  saveWorkflow,
} from "../server";
import { draftSpec, labelSpec } from "./specs";

beforeEach(resetDatabase);

describe("saveWorkflow", () => {
  it("saves a valid spec and reports its max risk and the approval it inserted", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);

    const saved = await saveWorkflow(orgA.admin.ctx, {
      name: "Pricing replies",
      spec: draftSpec(),
    });

    expect(saved.maxRisk).toBe("external_send");
    expect(saved.inserted).toEqual([
      { stepId: "reply-approval", after: "reply", action: "google-mail.create-draft" },
    ]);
    const workflow = await getWorkflow(orgA.admin.ctx, saved.id);
    expect(workflow).toMatchObject({
      id: saved.id,
      name: "Pricing replies",
      specId: "pricing-replies",
      maxRisk: "external_send",
      versions: [],
    });
    expect(workflow.workingSpec.steps.map((step) => step.id)).toEqual([
      "classify",
      "gate",
      "reply",
    ]);
    expect(await listWorkflows(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ id: saved.id, name: "Pricing replies", latestVersion: null }),
    ]);
  });
});

describe("saveWorkflow's validation", () => {
  async function adminWithGmail() {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    return orgA;
  }

  async function issuesOf(promise: Promise<unknown>) {
    const error: unknown = await promise.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    if (!(error instanceof SpecInvalidError)) throw new Error("expected a SpecInvalidError");
    return error.issues;
  }

  it("refuses an invalid spec with every issue, and saves nothing", async () => {
    const orgA = await adminWithGmail();
    const spec = draftSpec({ id: "Not A Slug", autonomy: { rung: 2 } });

    const issues = await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec }));

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([["id"], ["autonomy", "rung"]]),
    );
    expect(await listWorkflows(orgA.admin.ctx)).toEqual([]);
  });

  it("refuses an unknown model role", async () => {
    const orgA = await adminWithGmail();
    const spec = draftSpec();
    (spec.steps as Record<string, unknown>[])[0] = {
      ...(spec.steps as Record<string, unknown>[])[0],
      role: "gpt-5",
    };

    const issues = await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec }));

    expect(issues).toEqual([expect.objectContaining({ path: ["steps", 0, "role"] })]);
  });

  it("refuses an action the catalog doesn't have, naming it", async () => {
    const orgA = await adminWithGmail();
    const spec = labelSpec();
    (spec.steps as Record<string, unknown>[])[1] = {
      ...(spec.steps as Record<string, unknown>[])[1],
      action: "google-mail.delete-message",
    };

    const issues = await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Label", spec }));

    expect(issues).toEqual([
      {
        path: ["steps", 1, "action"],
        message: expect.stringContaining("delete-message") as string,
      },
    ]);
  });

  it("refuses a member spec when the admin has no Gmail connection of their own", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectOrgInbox(orgA.admin.ctx, "support@org-a.test");

    const issues = await issuesOf(
      saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() }),
    );

    expect(issues).toEqual([
      {
        path: ["credentials"],
        message: expect.stringContaining("your own Gmail connection") as string,
      },
    ]);
  });

  it("refuses an org spec in an org with no org Gmail connection", async () => {
    const orgA = await adminWithGmail();
    const spec = draftSpec({ credentials: "org" });

    const issues = await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec }));

    expect(issues).toEqual([
      {
        path: ["credentials"],
        message: expect.stringContaining("an org Gmail connection") as string,
      },
    ]);
  });

  it("accepts an org spec once the org has an org Gmail connection", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectOrgInbox(orgA.admin.ctx, "support@org-a.test");

    const saved = await saveWorkflow(orgA.admin.ctx, {
      name: "Support",
      spec: draftSpec({ credentials: "org" }),
    });

    expect(saved.maxRisk).toBe("external_send");
  });

  it("refuses a second workflow with the same spec ID", async () => {
    const orgA = await adminWithGmail();
    await saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() });

    await expect(
      saveWorkflow(orgA.admin.ctx, { name: "Again", spec: draftSpec() }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses an empty name", async () => {
    const orgA = await adminWithGmail();

    await expect(saveWorkflow(orgA.admin.ctx, { name: "  ", spec: draftSpec() })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("members", () => {
  it("can't list, read, save or publish workflows", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await connectGmail(orgA.member.ctx, orgA.member.email);
    const { id } = await saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() });
    const version = await publishWorkflow(orgA.admin.ctx, id);
    const member = orgA.member.ctx;

    await expect(listWorkflows(member)).rejects.toThrow(ForbiddenError);
    await expect(getWorkflow(member, id)).rejects.toThrow(ForbiddenError);
    await expect(getWorkflowVersion(member, version.id)).rejects.toThrow(ForbiddenError);
    await expect(saveWorkflow(member, { name: "Mine", spec: labelSpec() })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(publishWorkflow(member, id)).rejects.toThrow(ForbiddenError);
  });
});

describe("publishWorkflow", () => {
  it("publishes version 1, then version 2 after an edit, leaving version 1 unchanged", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    const { id } = await saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() });

    const first = await publishWorkflow(orgA.admin.ctx, id);
    await saveWorkflow(orgA.admin.ctx, { workflowId: id, name: "Pricing", spec: labelSpec() });
    const second = await publishWorkflow(orgA.admin.ctx, id);

    expect(first).toMatchObject({
      workflowId: id,
      number: 1,
      maxRisk: "external_send",
      requiredActions: ["google-mail.create-draft"],
      publishedBy: orgA.admin.id,
    });
    expect(first.spec.steps.map((step) => step.id)).toEqual([
      "classify",
      "gate",
      "reply",
      "reply-approval",
    ]);
    expect(second).toMatchObject({
      number: 2,
      maxRisk: "internal_reversible",
      requiredActions: ["google-mail.add-label"],
    });
    expect(await getWorkflowVersion(orgA.admin.ctx, first.id)).toEqual(first);
    expect((await getWorkflow(orgA.admin.ctx, id)).versions.map((v) => v.number)).toEqual([2, 1]);
    expect(await listWorkflows(orgA.admin.ctx)).toEqual([
      expect.objectContaining({
        id,
        latestVersion: expect.objectContaining({
          number: 2,
          maxRisk: "internal_reversible",
        }) as unknown,
      }),
    ]);
  });

  it("re-validates, so a spec whose connection is gone isn't published", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    const { id } = await saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() });
    for (const own of (await listConnections(orgA.admin.ctx)).connections) {
      await disconnect(orgA.admin.ctx, own.id);
    }

    await expect(publishWorkflow(orgA.admin.ctx, id)).rejects.toThrow(SpecInvalidError);
    expect((await getWorkflow(orgA.admin.ctx, id)).versions).toEqual([]);
  });

  it("lets a system ctx read a version, for runs", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    const { id } = await saveWorkflow(orgA.admin.ctx, { name: "Pricing", spec: draftSpec() });
    const version = await publishWorkflow(orgA.admin.ctx, id);

    expect(await getWorkflowVersion(systemCtx(orgA.id), version.id)).toEqual(version);
  });
});
