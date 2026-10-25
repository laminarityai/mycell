// Tag events whose send failed (#130, ADR-0027): a retried rename, delete or unassign finds its
// change made already and announces nothing, but the outbox job delivers the event the change
// saved, so working specs and enablements still follow. Delivered twice, an event changes
// nothing more.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { sendWaitingEvents } from "@/features/outbox/server";
import { deleteTag, renameTag, unassignTag } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  followTagRename,
  getWorkflow,
  listEnablements,
  publishWorkflow,
  removeInvisibleEnablements,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const later = () => new Date(Date.now() + 61_000);

// Org A: the member has `sales`, and has switched on a workflow published to it alone.
async function enabledThroughSales() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Sales labels", labelSpec(), ["sales"]);
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, sales, workflowId, system: systemCtx(orgA.id) };
}

// The one event the outbox job delivered with this name, as its function gets it.
async function deliveredByTheJob(orgId: string, name: string) {
  expect(fakeInngest.sent(name)).toEqual([]);
  await sendWaitingEvents(systemCtx(orgId), later());
  const sent = fakeInngest.sent(name);
  expect(sent).toHaveLength(1);
  return sent[0]?.data ?? {};
}

describe("a tag rename whose send failed", () => {
  it("still reaches working specs once retried, and following it twice changes nothing more", async () => {
    const { orgA, admin, sales, workflowId, system } = await enabledThroughSales();
    fakeInngest.failSends();
    await renameTag(admin.ctx, sales, "sales-team");
    fakeInngest.failSends(false);
    // The admin retries: the tag has its new name already.
    await renameTag(admin.ctx, sales, "sales-team");

    const data = await deliveredByTheJob(orgA.id, "tags/tag.renamed");
    expect(data).toEqual({ orgId: orgA.id, tagId: sales, from: "sales", to: "sales-team" });
    await followTagRename(system, { tagId: sales, from: "sales" });

    const followed = await getWorkflow(admin.ctx, workflowId);
    expect(followed.workingSpec.visibility).toEqual({ tags: ["sales-team"] });
    // Inngest delivers an event at least once: the second time, nothing names `sales` any more.
    expect(await followTagRename(system, { tagId: sales, from: "sales" })).toBe(0);
    expect((await getWorkflow(admin.ctx, workflowId)).revision).toBe(followed.revision);
    await expect(publishWorkflow(admin.ctx, workflowId)).resolves.toMatchObject({ number: 2 });
  });
});

describe("a tag deletion whose send failed", () => {
  it("still removes the enablements it hid once retried, and removing them twice changes nothing more", async () => {
    const { orgA, admin, sales, workflowId, system } = await enabledThroughSales();
    fakeInngest.failSends();
    await deleteTag(admin.ctx, sales);
    fakeInngest.failSends(false);
    // The admin retries: the tag is gone already.
    await expect(deleteTag(admin.ctx, sales)).rejects.toThrow(NotFoundError);

    expect(await deliveredByTheJob(orgA.id, "tags/tag.deleted")).toEqual({
      orgId: orgA.id,
      tagId: sales,
    });
    await removeInvisibleEnablements(system, {});
    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);

    await removeInvisibleEnablements(system, {});
    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);
  });
});

describe("unassigning a tag whose send failed", () => {
  it("still removes the member's enablement once retried, and removing it twice changes nothing more", async () => {
    const { orgA, admin, member, sales, workflowId, system } = await enabledThroughSales();
    await enable(admin.ctx, workflowId);
    fakeInngest.failSends();
    await unassignTag(admin.ctx, sales, member.id);
    fakeInngest.failSends(false);
    // The admin retries: the member doesn't have it already.
    await unassignTag(admin.ctx, sales, member.id);

    expect(await deliveredByTheJob(orgA.id, "tags/assignment.removed")).toEqual({
      orgId: orgA.id,
      tagId: sales,
      userId: member.id,
    });
    await removeInvisibleEnablements(system, { userId: member.id });
    const left = (await listEnablements(admin.ctx, workflowId)).map((e) => e.userId);
    expect(left).toEqual([admin.id]);

    await removeInvisibleEnablements(system, { userId: member.id });
    expect((await listEnablements(admin.ctx, workflowId)).map((e) => e.userId)).toEqual(left);
  });
});
