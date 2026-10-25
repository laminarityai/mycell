// The outbox (ADR-0027): a change and the events it sends are saved together. The change's own
// send goes right after the commit; when it fails, the job sends the event a minute later, under
// the same ID, so Inngest takes it as one event.
import { eventType } from "inngest";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { tagDeleted } from "@/features/tags/events";
import { createTag, listTags, renameTag } from "@/features/tags/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, InvariantError } from "@/lib/errors";
import { fakeInngest } from "@/testing/fake-inngest";
import { listOrgsWithWaitingEvents, saveWithEvents, sendWaitingEvents } from "../server";

beforeEach(resetDatabase);

/** A minute and a second from now: what has waited since now is due for the job. */
const later = () => new Date(Date.now() + 61_000);

// Renames a new tag `sales` to `sales-team`, whose event the rename sends.
async function renameSales(admin: Ctx) {
  const tag = await createTag(admin, "sales");
  await renameTag(admin, tag.id, "sales-team");
  return tag.id;
}

describe("a change's events", () => {
  it("are sent right after the commit, and leave nothing waiting", async () => {
    const { orgA } = await seedTwoOrgs();

    const tagId = await renameSales(orgA.admin.ctx);

    expect(fakeInngest.sent("tags/tag.renamed")).toMatchObject([
      {
        name: "tags/tag.renamed",
        id: `tag-renamed-${tagId}-1`,
        data: { orgId: orgA.id, tagId, from: "sales", to: "sales-team" },
      },
    ]);
    expect(await listOrgsWithWaitingEvents(later())).toEqual([]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 0 });
  });

  it("whose send fails after the commit are delivered by the job, under the same ID", async () => {
    const { orgA } = await seedTwoOrgs();
    fakeInngest.failSends();

    // The change is saved and the action succeeds: its event waits in the outbox.
    const tagId = await renameSales(orgA.admin.ctx);
    expect((await listTags(orgA.admin.ctx)).map((tag) => tag.name)).toEqual(["sales-team"]);
    expect(fakeInngest.sent()).toEqual([]);

    fakeInngest.failSends(false);
    expect(await listOrgsWithWaitingEvents(later())).toEqual([orgA.id]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 1 });

    expect(fakeInngest.sent()).toMatchObject([
      {
        name: "tags/tag.renamed",
        id: `tag-renamed-${tagId}-1`,
        data: { orgId: orgA.id, tagId, from: "sales", to: "sales-team" },
      },
    ]);
    // Inngest has it, so it's gone from the outbox.
    expect(await listOrgsWithWaitingEvents(later())).toEqual([]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 0 });
  });

  it("are left to their own send for a minute: the job sends only what's waited longer", async () => {
    const { orgA } = await seedTwoOrgs();
    fakeInngest.failSends();
    await renameSales(orgA.admin.ctx);
    fakeInngest.failSends(false);

    const soon = new Date(Date.now() + 30_000);
    expect(await listOrgsWithWaitingEvents(soon)).toEqual([]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), soon)).toEqual({ sent: 0 });
    expect(fakeInngest.sent()).toEqual([]);

    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 1 });
  });

  it("wait for the job's next run when its send fails too", async () => {
    const { orgA } = await seedTwoOrgs();
    fakeInngest.failSends();
    await renameSales(orgA.admin.ctx);

    // The job's step fails, for Inngest to retry it; the event stays.
    await expect(sendWaitingEvents(systemCtx(orgA.id), later())).rejects.toThrow();
    fakeInngest.failSends(false);

    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 1 });
    expect(fakeInngest.sent("tags/tag.renamed")).toHaveLength(1);
  });

  it("are neither saved nor sent when the change fails", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.admin.ctx;
    const tag = await createTag(ctx, "sales");

    await expect(
      saveWithEvents(ctx, (_tx, emit) => {
        emit(tagDeleted, { orgId: orgA.id, tagId: tag.id }, `tag-deleted-${tag.id}`);
        throw new ConflictError("The change failed.");
      }),
    ).rejects.toThrow(ConflictError);

    expect(fakeInngest.sent()).toEqual([]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 0 });
  });

  it("wait once when the same event is written again while it waits", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.admin.ctx;
    fakeInngest.failSends();
    const deleted = (_tx: unknown, emit: Parameters<Parameters<typeof saveWithEvents>[1]>[1]) => {
      emit(tagDeleted, { orgId: orgA.id, tagId: "tag-1" }, "tag-deleted-tag-1");
      return Promise.resolve();
    };

    await saveWithEvents(ctx, deleted);
    await saveWithEvents(ctx, deleted);
    fakeInngest.failSends(false);

    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 1 });
  });

  it("must be events the outbox carries, with data that fits them, or nothing is saved", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = orgA.admin.ctx;
    const stray = eventType("tests/stray", { schema: z.object({ orgId: z.string() }) });

    await expect(
      saveWithEvents(ctx, (_tx, emit) => {
        emit(stray, { orgId: orgA.id }, "stray-1");
        return Promise.resolve();
      }),
    ).rejects.toThrow(InvariantError);
    await expect(
      saveWithEvents(ctx, (_tx, emit) => {
        emit(tagDeleted, { orgId: orgA.id, tagId: "" }, "tag-deleted-none");
        return Promise.resolve();
      }),
    ).rejects.toThrow(InvariantError);

    expect(fakeInngest.sent()).toEqual([]);
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 0 });
  });
});

describe("the outbox job", () => {
  it("acts in each org as its system ctx, sending only that org's events", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    fakeInngest.failSends();
    const tagA = await renameSales(orgA.admin.ctx);
    const tagB = await renameSales(orgB.admin.ctx);
    fakeInngest.failSends(false);

    expect(await listOrgsWithWaitingEvents(later())).toEqual([orgA.id, orgB.id].sort());
    expect(await sendWaitingEvents(systemCtx(orgA.id), later())).toEqual({ sent: 1 });

    expect(fakeInngest.sent().map((event) => event.id)).toEqual([`tag-renamed-${tagA}-1`]);
    expect(await listOrgsWithWaitingEvents(later())).toEqual([orgB.id]);
    expect(await sendWaitingEvents(systemCtx(orgB.id), later())).toEqual({ sent: 1 });
    expect(fakeInngest.sent().map((event) => event.id)).toEqual([
      `tag-renamed-${tagA}-1`,
      `tag-renamed-${tagB}-1`,
    ]);
  });

  it("is for the system ctx alone", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(sendWaitingEvents(orgA.admin.ctx, later())).rejects.toThrow(ForbiddenError);
    await expect(sendWaitingEvents(orgA.member.ctx, later())).rejects.toThrow(ForbiddenError);
  });
});
