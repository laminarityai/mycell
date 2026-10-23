// Losing sight of a workflow (M5): tags decide who runs what, so a member who can no longer see
// a workflow loses their enablement of it. Unassigning or deleting a tag announces it, and a job
// cleans up as the system ctx; publishing to fewer tags cleans up in the publish itself.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { queriesOnOtherConnections } from "@/db/testing/transaction-queries";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { deleteTag, unassignTag } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { enable, listEnablements, publishWorkflow, removeInvisibleEnablements } from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

// Org A: the member has `sales` and `support`. One workflow is published to `sales` alone,
// another to both, and the member has both switched on.
async function enabledThroughSales() {
  const { orgA, orgB } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const support = await tagUsers(admin.ctx, "support", [member]);
  const salesOnly = await publishTo(admin.ctx, "Sales labels", labelSpec(), ["sales"]);
  const both = await publishTo(admin.ctx, "Shared labels", labelSpec({ id: "shared-labels" }), [
    "sales",
    "support",
  ]);
  await enable(member.ctx, salesOnly.workflowId);
  await enable(member.ctx, both.workflowId);
  return {
    orgA,
    orgB,
    admin,
    member,
    sales,
    support,
    salesOnly: salesOnly.workflowId,
    both: both.workflowId,
  };
}

const enabledBy = async (admin: Parameters<typeof listEnablements>[0], workflowId: string) =>
  (await listEnablements(admin, workflowId)).map((enablement) => enablement.userId);

describe("unassigning a tag", () => {
  it("removes the member's enablement of a workflow they no longer see, and keeps one they still do", async () => {
    const { orgA, admin, member, sales, salesOnly, both } = await enabledThroughSales();

    await unassignTag(admin.ctx, sales, member.id);
    // What the job does on the event unassigning sent.
    expect(fakeInngest.sent("tags/assignment.removed").map((event) => event.data)).toEqual([
      { orgId: orgA.id, tagId: sales, userId: member.id },
    ]);
    await removeInvisibleEnablements(systemCtx(orgA.id), { userId: member.id });

    expect(await enabledBy(admin.ctx, salesOnly)).toEqual([]);
    expect(await enabledBy(admin.ctx, both)).toEqual([member.id]);
  });
});

describe("deleting a tag", () => {
  it("removes the enablements that depended on it alone", async () => {
    const { orgA, admin, member, sales, salesOnly, both } = await enabledThroughSales();

    await deleteTag(admin.ctx, sales);
    // What the job does on the event deleting sent.
    expect(fakeInngest.sent("tags/tag.deleted").map((event) => event.data)).toEqual([
      { orgId: orgA.id, tagId: sales },
    ]);
    await removeInvisibleEnablements(systemCtx(orgA.id), {});

    expect(await enabledBy(admin.ctx, salesOnly)).toEqual([]);
    expect(await enabledBy(admin.ctx, both)).toEqual([member.id]);
  });
});

describe("publishing a version to fewer tags", () => {
  it("removes the enablements of members who no longer see it, in the publish itself", async () => {
    const { admin, salesOnly } = await enabledThroughSales();
    await tagUsers(admin.ctx, "finance", []);
    await enable(admin.ctx, salesOnly);

    await publishWorkflow(admin.ctx, salesOnly, { tags: ["finance"] });

    // Admins see every workflow, so theirs stays.
    expect(await enabledBy(admin.ctx, salesOnly)).toEqual([admin.id]);
  });

  it("keeps the enablements of members still published to", async () => {
    const { admin, member, both } = await enabledThroughSales();

    await publishWorkflow(admin.ctx, both, { tags: ["support"] });

    expect(await enabledBy(admin.ctx, both)).toEqual([member.id]);
  });

  it("reads who sees it before the transaction, which then queries only its own connection", async () => {
    const { admin, member, salesOnly, both } = await enabledThroughSales();
    await tagUsers(admin.ctx, "finance", []);

    const stray = await queriesOnOtherConnections(async () => {
      await publishWorkflow(admin.ctx, salesOnly, { tags: ["finance"] });
      await publishWorkflow(admin.ctx, both, { tags: ["support"] });
    });

    expect(stray).toEqual([]);
    expect(await enabledBy(admin.ctx, salesOnly)).toEqual([]);
    expect(await enabledBy(admin.ctx, both)).toEqual([member.id]);
  });
});

describe("removing invisible enablements", () => {
  it("is for admins and the system ctx, not members", async () => {
    const { member } = await enabledThroughSales();

    await expect(removeInvisibleEnablements(member.ctx, { userId: member.id })).rejects.toThrow(
      ForbiddenError,
    );
  });
});
