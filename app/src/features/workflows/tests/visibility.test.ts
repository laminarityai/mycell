import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { assignTag, deleteTag, renameTag } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  followTagRename,
  getVisibleWorkflow,
  getWorkflow,
  listVisibleWorkflows,
  listWorkflows,
  publishWorkflow,
  saveWorkflow,
} from "../server";
import { draftSpec, labelSpec, sheetSpec } from "./specs";

beforeEach(resetDatabase);

// Org A: the member has `sales`; nobody has `support`. Two workflows, one published to each.
async function salesAndSupport() {
  const orgs = await seedTwoOrgs();
  const { admin, member } = orgs.orgA;
  await connectGmail(admin.ctx, admin.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const support = await tagUsers(admin.ctx, "support", []);
  const pricing = await publishTo(admin.ctx, "Pricing replies", draftSpec(), ["sales"]);
  const labels = await publishTo(admin.ctx, "Support labels", labelSpec(), ["support"]);
  return { ...orgs, admin, member, sales, support, pricing, labels };
}

describe("a member's workflows", () => {
  it("are the ones published to a tag they have, and no others", async () => {
    const { member, pricing } = await salesAndSupport();

    const visible = await listVisibleWorkflows(member.ctx);

    expect(visible.map((workflow) => workflow.id)).toEqual([pricing.workflowId]);
    expect(visible[0]).toMatchObject({
      name: "Pricing replies",
      credentials: "member",
      maxRisk: "external_send",
      requiredApps: ["Gmail"],
      switch: null,
    });
    expect(visible[0]?.description.length).toBeGreaterThan(0);
  });

  it("include org-credential ones, which say so, and what they need from Sheets", async () => {
    const { admin, member } = await salesAndSupport();
    await connectOrgInbox(admin.ctx, "support@org-a.test");
    const shared = await publishTo(
      admin.ctx,
      "Shared",
      labelSpec({ id: "shared", credentials: "org" }),
      ["sales"],
    );
    const prices = await publishTo(admin.ctx, "Prices", sheetSpec(), ["sales"]);

    expect(await getVisibleWorkflow(member.ctx, shared.workflowId)).toMatchObject({
      credentials: "org",
      maxRisk: "internal_reversible",
      requiredApps: ["Gmail"],
    });
    expect((await getVisibleWorkflow(member.ctx, prices.workflowId)).requiredApps).toEqual([
      "Gmail",
      "Sheets",
    ]);
  });

  it("leave out a workflow not yet published, and one published to no tags", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await tagUsers(orgA.admin.ctx, "sales", [orgA.member]);
    await saveWorkflow(orgA.admin.ctx, {
      name: "Draft",
      spec: draftSpec({ visibility: { tags: ["sales"] } }),
    });
    const untagged = await publishTo(orgA.admin.ctx, "Labels", labelSpec(), []);

    expect(await listVisibleWorkflows(orgA.member.ctx)).toEqual([]);
    // Admins see every published workflow, untagged too.
    expect((await listVisibleWorkflows(orgA.admin.ctx)).map((workflow) => workflow.id)).toEqual([
      untagged.workflowId,
    ]);
  });

  it("can be read one by one; one published elsewhere is not found", async () => {
    const { member, pricing, labels } = await salesAndSupport();

    expect(await getVisibleWorkflow(member.ctx, pricing.workflowId)).toMatchObject({
      id: pricing.workflowId,
      name: "Pricing replies",
    });
    await expect(getVisibleWorkflow(member.ctx, labels.workflowId)).rejects.toThrow(NotFoundError);
  });

  it("stay visible when their tag is renamed", async () => {
    const { admin, member, sales, pricing } = await salesAndSupport();

    await renameTag(admin.ctx, sales, "sales-team");

    expect((await listVisibleWorkflows(member.ctx)).map((workflow) => workflow.id)).toEqual([
      pricing.workflowId,
    ]);
  });

  it("publish again from the working spec once a renamed tag is followed", async () => {
    const { orgA, admin, member, sales, pricing } = await salesAndSupport();

    await renameTag(admin.ctx, sales, "sales-team");
    const renamed = fakeInngest.sent("tags/tag.renamed").map((event) => event.data);
    expect(renamed).toEqual([{ orgId: orgA.id, tagId: sales, from: "sales", to: "sales-team" }]);
    // What the job does with the event, as the org's system ctx.
    await followTagRename(systemCtx(orgA.id), { tagId: sales, from: "sales" });

    const workflow = await getWorkflow(admin.ctx, pricing.workflowId);
    expect(workflow.workingSpec.visibility).toEqual({ tags: ["sales-team"] });
    await publishWorkflow(admin.ctx, pricing.workflowId);
    expect((await listVisibleWorkflows(member.ctx)).map((visible) => visible.id)).toEqual([
      pricing.workflowId,
    ]);
  });

  it("follow a tag renamed twice to its current name, whichever rename is followed first", async () => {
    const { orgA, admin, sales, pricing } = await salesAndSupport();
    await renameTag(admin.ctx, sales, "sellers");
    await renameTag(admin.ctx, sales, "sales-team");

    await followTagRename(systemCtx(orgA.id), { tagId: sales, from: "sellers" });
    await followTagRename(systemCtx(orgA.id), { tagId: sales, from: "sales" });

    const workflow = await getWorkflow(admin.ctx, pricing.workflowId);
    expect(workflow.workingSpec.visibility).toEqual({ tags: ["sales-team"] });
    await expect(publishWorkflow(admin.ctx, pricing.workflowId)).resolves.toMatchObject({
      number: 2,
    });
  });

  it("are left alone by a rename that touches none of their tags", async () => {
    const { orgA, admin, support, pricing } = await salesAndSupport();
    const before = await getWorkflow(admin.ctx, pricing.workflowId);
    await renameTag(admin.ctx, support, "helpdesk");

    await followTagRename(systemCtx(orgA.id), { tagId: support, from: "support" });

    const after = await getWorkflow(admin.ctx, pricing.workflowId);
    expect(after.revision).toBe(before.revision);
    expect(after.workingSpec.visibility).toEqual({ tags: ["sales"] });
  });

  it("are hidden when their tag is deleted", async () => {
    const { admin, member, sales, pricing } = await salesAndSupport();

    await deleteTag(admin.ctx, sales);

    expect(await listVisibleWorkflows(member.ctx)).toEqual([]);
    await expect(getVisibleWorkflow(member.ctx, pricing.workflowId)).rejects.toThrow(NotFoundError);
  });

  it("are decided by the latest version's tags", async () => {
    const { admin, member, pricing } = await salesAndSupport();
    await saveWorkflow(admin.ctx, {
      workflowId: pricing.workflowId,
      name: "Pricing replies",
      spec: draftSpec({ visibility: { tags: ["support"] } }),
    });

    await publishWorkflow(admin.ctx, pricing.workflowId);

    expect(await listVisibleWorkflows(member.ctx)).toEqual([]);
  });
});

describe("an admin's workflows", () => {
  it("are every workflow, each with the tags it's published to and how many users they reach", async () => {
    const { admin, member, support, pricing, labels } = await salesAndSupport();
    await assignTag(admin.ctx, support, admin.id);
    const both = await publishTo(admin.ctx, "Both", labelSpec({ id: "both" }), [
      "support",
      "sales",
    ]);

    const visible = await listVisibleWorkflows(admin.ctx);

    expect(visible.map((workflow) => [workflow.name, workflow.audience])).toEqual([
      [
        "Both",
        {
          tags: [
            { id: expect.any(String) as string, name: "sales" },
            { id: support, name: "support" },
          ],
          reach: 2,
        },
      ],
      ["Pricing replies", { tags: [expect.objectContaining({ name: "sales" })], reach: 1 }],
      ["Support labels", { tags: [{ id: support, name: "support" }], reach: 1 }],
    ]);
    expect((await getVisibleWorkflow(admin.ctx, labels.workflowId)).audience?.reach).toBe(1);
    // The admin's list of every workflow, drafts included, shows the same.
    expect(
      (await listWorkflows(admin.ctx)).map((workflow) => workflow.audience?.reach ?? null),
    ).toEqual([2, 1, 1]);
    // Members don't learn who else a workflow reaches.
    expect((await getVisibleWorkflow(member.ctx, pricing.workflowId)).audience).toBeNull();
    expect((await getVisibleWorkflow(member.ctx, both.workflowId)).audience).toBeNull();
  });
});

describe("publishing to tags", () => {
  it("refuses a tag name the org doesn't have, and publishes nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await tagUsers(orgA.admin.ctx, "sales", [orgA.member]);
    const { id } = await saveWorkflow(orgA.admin.ctx, {
      name: "Pricing replies",
      spec: draftSpec({ visibility: { tags: ["sales", "slaes"] } }),
    });

    await expect(publishWorkflow(orgA.admin.ctx, id)).rejects.toThrow(ValidationError);
    await expect(publishWorkflow(orgA.admin.ctx, id)).rejects.toThrow(/"slaes"/);
    expect((await getWorkflow(orgA.admin.ctx, id)).versions).toEqual([]);
  });

  it("can choose the tags as it publishes, and the working spec keeps them", async () => {
    const { admin, member, labels } = await salesAndSupport();
    const before = await getWorkflow(admin.ctx, labels.workflowId);

    const version = await publishWorkflow(admin.ctx, labels.workflowId, { tags: ["sales"] });

    expect(version.spec.visibility).toEqual({ tags: ["sales"] });
    const after = await getWorkflow(admin.ctx, labels.workflowId);
    expect(after.workingSpec).toEqual({ ...before.workingSpec, visibility: { tags: ["sales"] } });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.unpublishedChanges).toBe(false);
    expect(await getVisibleWorkflow(member.ctx, labels.workflowId)).toMatchObject({
      name: "Support labels",
      versionNumber: 2,
    });
  });

  it("refuses chosen tags the org doesn't have, and leaves the working spec as it was", async () => {
    const { admin, labels } = await salesAndSupport();
    const before = await getWorkflow(admin.ctx, labels.workflowId);

    await expect(
      publishWorkflow(admin.ctx, labels.workflowId, { tags: ["marketing"] }),
    ).rejects.toThrow(ValidationError);

    expect(await getWorkflow(admin.ctx, labels.workflowId)).toEqual(before);
  });
});
