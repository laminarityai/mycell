// Opening and acting on a review. Every call to the item's app goes through its pending-form
// adapter, chosen by the review's kind, with the caller's ctx and the review's own connection.
// Acting claims the review first, so the first to act wins and nothing is carried out twice.
// Content (the message, the draft, an edit) is held in memory only (invariant 8).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import {
  escalationAdapter,
  gmailDraftAdapter,
  ItemGoneError,
  type PendingFormAdapter,
  type PendingItem,
  type ReviewEdits,
} from "@/features/runtime/adapters";
import type { Ctx } from "@/lib/ctx";
import { AlreadyHandledError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { reviewActions, type OpenedReview, type PendingForms, type ReviewAction } from "../types";
import { endReview, itemOf, reviewOf, visibleReview, type ReviewRow } from "./reviews";
import { reviews } from "./schema";

const pendingForms: PendingForms = { approval: gmailDraftAdapter, escalation: escalationAdapter };

/**
 * Opens a review the caller may see: asks its adapter where the item stands, ends the review
 * there if the item was finished in its app or is gone, and otherwise fetches it live.
 */
export async function openReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<OpenedReview> {
  let row = await visibleReview(ctx, reviewId);
  if (row.status === "waiting") {
    const adapter = adapters[row.kind];
    const state = await adapter.check(ctx, itemOf(row));
    if (state === "waiting") {
      try {
        const view = await adapter.view(ctx, itemOf(row));
        return { review: await reviewOf(ctx, row), view };
      } catch (error) {
        if (!(error instanceof ItemGoneError)) throw error;
      }
    }
    const ending = state === "waiting" ? "gone" : state;
    row = (await endReview(ctx, row.id, ending, null)) ?? (await visibleReview(ctx, row.id));
  }
  return { review: await reviewOf(ctx, row), view: null };
}

/**
 * Asks each waiting review's adapter where its item stands, and ends the ones finished in their
 * app or gone, with no one named. For the daily digest, as the org's system ctx, before it
 * counts. A review whose app can't be asked now (a connection needing reauthorization) waits on.
 */
export async function checkWaitingReviews(
  ctx: Ctx,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const waiting = await forOrg(ctx).select(reviews, { where: eq(reviews.status, "waiting") });
  for (const row of waiting) {
    let state: Awaited<ReturnType<PendingFormAdapter["check"]>>;
    try {
      state = await adapters[row.kind].check(ctx, itemOf(row));
    } catch (error) {
      console.warn(`Couldn't check review ${row.id}; it waits on.`, error);
      continue;
    }
    if (state !== "waiting") await endReview(ctx, row.id, state, null);
  }
}

/** Sends the item as it was prepared. Ends the review `approved`. */
export async function approveReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "approve", adapters, (adapter, item) => adapter.approve(ctx, item));
}

/** Sends the item with the caller's edits, held in memory only. Ends it `edited_approved`. */
export async function approveEditedReview(
  ctx: Ctx,
  reviewId: string,
  edits: ReviewEdits,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  if (edits.text.trim() === "") throw new ValidationError("Write the reply before sending it.");
  await act(ctx, reviewId, "edit", adapters, (adapter, item) => adapter.approve(ctx, item, edits));
}

/** Removes the waiting item from its app. Ends the review `declined`. */
export async function declineReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "decline", adapters, async (adapter, item) => {
    await adapter.decline?.(ctx, item);
  });
}

/**
 * Marks an escalation done: the person handled the message themselves. Changes nothing in
 * Gmail. Ends the review `done_in_app`, by the caller.
 */
export async function markDone(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "done", adapters, (adapter, item) => adapter.approve(ctx, item));
}

const ENDINGS = {
  approve: "approved",
  edit: "edited_approved",
  decline: "declined",
  done: "done_in_app",
} as const satisfies Record<ReviewAction, string>;
type Ending = (typeof ENDINGS)[ReviewAction];

/**
 * Claims the review by the caller with the ending `action` gives it, then carries the action
 * out through its adapter. ValidationError when the review's kind doesn't offer the action, and
 * AlreadyHandledError when it isn't waiting any more, each with nothing carried out. If carrying
 * it out fails, the claim is undone: the review waits again, or ends `gone` with its item.
 */
async function act(
  ctx: Ctx,
  reviewId: string,
  action: ReviewAction,
  adapters: PendingForms,
  carryOut: (adapter: PendingFormAdapter, item: PendingItem) => Promise<void>,
): Promise<void> {
  const row = await visibleReview(ctx, reviewId);
  if (!(reviewActions[row.kind] as readonly ReviewAction[]).includes(action)) {
    throw new ValidationError(`This review can't be ${ACTION_WORDS[action]}.`);
  }
  const ending = ENDINGS[action];
  const claimed = await endReview(ctx, row.id, ending, ctx.userId);
  if (claimed === undefined) throw new AlreadyHandledError();
  try {
    await carryOut(adapters[row.kind], itemOf(row));
  } catch (error) {
    const gone = error instanceof ItemGoneError;
    await undoClaim(ctx, row, ending, gone);
    if (gone)
      throw new ConflictError("It's no longer waiting in its app, so the review has ended.");
    throw error;
  }
}

const ACTION_WORDS: Record<ReviewAction, string> = {
  approve: "approved",
  edit: "edited",
  decline: "declined",
  done: "marked done",
};

async function undoClaim(ctx: Ctx, row: ReviewRow, ending: Ending, gone: boolean) {
  await forOrg(ctx).update(
    reviews,
    gone
      ? { status: "gone", endedByUserId: null, endedAt: new Date() }
      : { status: "waiting", endedByUserId: null, endedAt: null },
    and(eq(reviews.id, row.id), eq(reviews.status, ending)),
  );
}
