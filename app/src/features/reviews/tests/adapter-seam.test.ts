// `reviews` reaches the app only through the pending-form adapter of the review's kind: given a
// fake adapter, opening and acting on reviews call its operations and nothing reaches Gmail.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { ItemState, PendingItem, ReviewEdits } from "@/features/runtime/adapters";
import type { Ctx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import {
  approveEditedReview,
  approveReview,
  declineReview,
  listReviews,
  markDone,
  openReview,
} from "../server";
import type { PendingForms } from "../types";
import { memberEscalation } from "./escalation-helpers";
import { memberReview } from "./review-helpers";

beforeEach(resetDatabase);

const VIEW = {
  kind: "draft" as const,
  message: { from: "a@b.test", to: "c@d.test", subject: "Hi", date: "", text: "Question" },
  draft: { from: "", to: "a@b.test", subject: "Re: Hi", date: "", text: "Answer" },
};

/** An adapter that records each operation it's asked for, and finds items in `state`. */
function recordingAdapter(state: ItemState = "waiting") {
  const calls: { operation: string; itemRef: string; edits?: ReviewEdits }[] = [];
  const record = (operation: string, item: PendingItem, edits?: ReviewEdits) => {
    calls.push({ operation, itemRef: item.itemRef, ...(edits ? { edits } : {}) });
  };
  const adapter: PendingForms["approval"] = {
    prepare: () => Promise.reject(new Error("reviews never prepares")),
    approve: (_ctx, item, edits) => {
      record("approve", item, edits);
      return Promise.resolve();
    },
    decline: (_ctx, item) => {
      record("decline", item);
      return Promise.resolve();
    },
    check: (_ctx, item) => {
      record("check", item);
      return Promise.resolve(state);
    },
    view: (_ctx, item) => {
      record("view", item);
      return Promise.resolve(VIEW);
    },
  };
  const adapters: PendingForms = { approval: adapter, escalation: adapter };
  return { adapters, calls };
}

/** Org A's member's review, with every proxied request from here on recorded. */
async function seeded() {
  const orgs = await seedTwoOrgs();
  const owner = orgs.orgA.member.ctx;
  const { draft } = await memberReview(orgs);
  const review = (await listReviews(owner)).at(0);
  const proxied: string[] = [];
  fakeNango.beforeProxy((path) => {
    proxied.push(path);
  });
  return { owner, draft, reviewId: review?.id ?? "", proxied };
}

describe("the adapter seam", () => {
  it("opens a review through the adapter's check and view only", async () => {
    const { owner, draft, reviewId, proxied } = await seeded();
    const { adapters, calls } = recordingAdapter();

    const opened = await openReview(owner, reviewId, adapters);

    expect(opened.view).toEqual(VIEW);
    expect(calls).toEqual([
      { operation: "check", itemRef: draft.id },
      { operation: "view", itemRef: draft.id },
    ]);
    expect(proxied).toEqual([]);
  });

  it("ends a review as the adapter's check finds its item", async () => {
    const { owner, draft, reviewId, proxied } = await seeded();
    const { adapters, calls } = recordingAdapter("done_in_app");

    const opened = await openReview(owner, reviewId, adapters);

    expect(opened).toMatchObject({ review: { status: "done_in_app" }, view: null });
    expect(calls).toEqual([{ operation: "check", itemRef: draft.id }]);
    expect(proxied).toEqual([]);
  });

  it.each([
    {
      action: "approves",
      act: (ctx: Ctx, id: string, adapters: PendingForms) => approveReview(ctx, id, adapters),
      expected: { operation: "approve" },
    },
    {
      action: "approves an edit",
      act: (ctx: Ctx, id: string, adapters: PendingForms) =>
        approveEditedReview(ctx, id, { text: "Edited" }, adapters),
      expected: { operation: "approve", edits: { text: "Edited" } },
    },
    {
      action: "declines",
      act: (ctx: Ctx, id: string, adapters: PendingForms) => declineReview(ctx, id, adapters),
      expected: { operation: "decline" },
    },
  ])("$action through the adapter only", async ({ act, expected }) => {
    const { owner, draft, reviewId, proxied } = await seeded();
    const { adapters, calls } = recordingAdapter();

    await act(owner, reviewId, adapters);

    expect(calls).toEqual([{ ...expected, itemRef: draft.id }]);
    expect(proxied).toEqual([]);
  });

  it("marks an escalation done through its adapter's approve only", async () => {
    const orgs = await seedTwoOrgs();
    const owner = orgs.orgA.member.ctx;
    const { message } = await memberEscalation(orgs);
    const reviewId = (await listReviews(owner)).at(0)?.id ?? "";
    const proxied: string[] = [];
    fakeNango.beforeProxy((path) => {
      proxied.push(path);
    });
    const { adapters, calls } = recordingAdapter();

    await markDone(owner, reviewId, adapters);

    expect(calls).toEqual([{ operation: "approve", itemRef: message.id }]);
    expect(proxied).toEqual([]);
  });
});
