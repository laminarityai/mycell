// What renaming, deleting and unassigning a tag announce (ADR-0027): each event goes through the
// outbox with its change, under an ID derived from that change, so the change's own send and the
// outbox job's are one event to Inngest, while the next change is a new one.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { sendWaitingEvents } from "@/features/outbox/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import { assignTag, createTag, deleteTag, renameTag, unassignTag } from "../server";

beforeEach(resetDatabase);

const later = () => new Date(Date.now() + 61_000);
const ids = (name: string) => fakeInngest.sent(name).map((event) => event.id);

describe("renaming a tag", () => {
  it("names the revision each rename made, so renaming back and forth is a new event each time", async () => {
    const { orgA } = await seedTwoOrgs();
    const tag = await createTag(orgA.admin.ctx, "sales");

    await renameTag(orgA.admin.ctx, tag.id, "sellers");
    await renameTag(orgA.admin.ctx, tag.id, "sales");
    await renameTag(orgA.admin.ctx, tag.id, "sellers");
    // Renaming it to the name it has changes nothing, and announces nothing.
    await renameTag(orgA.admin.ctx, tag.id, "sellers");

    expect(ids("tags/tag.renamed")).toEqual(
      ["1", "2", "3"].map((n) => `tag-renamed-${tag.id}-${n}`),
    );
  });

  it("retried after its send failed, announces nothing new; the outbox job sends the rename", async () => {
    const { orgA } = await seedTwoOrgs();
    const tag = await createTag(orgA.admin.ctx, "sales");
    fakeInngest.failSends();
    await renameTag(orgA.admin.ctx, tag.id, "sellers");
    fakeInngest.failSends(false);

    await renameTag(orgA.admin.ctx, tag.id, "sellers");
    expect(fakeInngest.sent()).toEqual([]);
    await sendWaitingEvents(systemCtx(orgA.id), later());

    expect(fakeInngest.sent("tags/tag.renamed")).toMatchObject([
      { id: `tag-renamed-${tag.id}-1`, data: { tagId: tag.id, from: "sales", to: "sellers" } },
    ]);
  });
});

describe("deleting a tag", () => {
  it("retried after its send failed, finds no tag; the outbox job sends the deletion", async () => {
    const { orgA } = await seedTwoOrgs();
    const tag = await createTag(orgA.admin.ctx, "sales");
    fakeInngest.failSends();
    await deleteTag(orgA.admin.ctx, tag.id);
    fakeInngest.failSends(false);

    await expect(deleteTag(orgA.admin.ctx, tag.id)).rejects.toThrow(NotFoundError);
    await sendWaitingEvents(systemCtx(orgA.id), later());

    expect(ids("tags/tag.deleted")).toEqual([`tag-deleted-${tag.id}`]);
  });
});

describe("unassigning a tag", () => {
  it("names the assignment it ended, so taking a tag away again after giving it back is a new event", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    const tag = await createTag(admin.ctx, "sales");

    await assignTag(admin.ctx, tag.id, member.id);
    await unassignTag(admin.ctx, tag.id, member.id);
    // Wait out the millisecond the first assignment was made in.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assignTag(admin.ctx, tag.id, member.id);
    await unassignTag(admin.ctx, tag.id, member.id);
    // They don't have it now: nothing changes, and nothing is announced.
    await unassignTag(admin.ctx, tag.id, member.id);

    const sent = ids("tags/assignment.removed");
    expect(sent).toHaveLength(2);
    expect(new Set(sent).size).toBe(2);
    for (const id of sent) expect(id).toMatch(`tag-unassigned-${tag.id}-${member.id}-`);
  });
});
