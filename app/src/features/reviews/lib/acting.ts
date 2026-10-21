// Opening and acting on a review. Every call to the item's app goes through its pending-form
// adapter, chosen by the review's kind, with the caller's ctx and the review's own connection.
// Acting claims the review first, so the first to act wins and nothing is carried out twice.
// Content (the message, the draft, an edit) is held in memory only (invariant 8).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import {
  gmailDraftAdapter,
  ItemGoneError,
  type PendingFormAdapter,
  type PendingItem,
  type ReviewEdits,
} from "@/features/runtime/adapters";
import type { Ctx } from "@/lib/ctx";
import { AlreadyHandledError, ConflictError, ValidationError } from "@/lib/errors";
import type { OpenedReview, PendingForms } from "../types";
import { endReview, itemOf, reviewOf, visibleReview, type ReviewRow } from "./reviews";
import { reviews } from "./schema";

const pendingForms: PendingForms = { approval: gmailDraftAdapter };

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

/** Sends the item as it was prepared. Ends the review `approved`. */
export async function approveReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "approved", adapters, (adapter, item) => adapter.approve(ctx, item));
}

/** Sends the item with the caller's edits, held in memory only. Ends it `edited_approved`. */
export async function approveEditedReview(
  ctx: Ctx,
  reviewId: string,
  edits: ReviewEdits,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  if (edits.text.trim() === "") throw new ValidationError("Write the reply before sending it.");
  await act(ctx, reviewId, "edited_approved", adapters, (adapter, item) =>
    adapter.approve(ctx, item, edits),
  );
}

/** Removes the waiting item from its app. Ends the review `declined`. */
export async function declineReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "declined", adapters, (adapter, item) => adapter.decline(ctx, item));
}

type Ending = "approved" | "edited_approved" | "declined";

/**
 * Claims the review as `ending` by the caller, then carries it out through its adapter.
 * AlreadyHandledError, with nothing carried out, when it isn't waiting any more. If carrying it
 * out fails, the claim is undone: the review waits again, or ends `gone` with its item.
 */
async function act(
  ctx: Ctx,
  reviewId: string,
  ending: Ending,
  adapters: PendingForms,
  carryOut: (adapter: PendingFormAdapter, item: PendingItem) => Promise<void>,
): Promise<void> {
  const row = await visibleReview(ctx, reviewId);
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

async function undoClaim(ctx: Ctx, row: ReviewRow, ending: Ending, gone: boolean) {
  await forOrg(ctx).update(
    reviews,
    gone
      ? { status: "gone", endedByUserId: null, endedAt: new Date() }
      : { status: "waiting", endedByUserId: null, endedAt: null },
    and(eq(reviews.id, row.id), eq(reviews.status, ending)),
  );
}
