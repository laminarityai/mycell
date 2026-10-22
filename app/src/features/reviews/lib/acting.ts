// Opening and acting on a review. Every call to the item's app goes through its pending-form
// adapter, chosen by the review's kind, on the review's own connection, with the caller's ctx
// delegated that connection once the caller is known to see the review (ADR-0016): so a
// colleague sends a handed-on draft from its owner's mailbox. Acting claims the review first,
// so the first to act wins and nothing is carried out twice.
// Content (the message, the draft, an edit) is held in memory only (invariant 8).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { delegatedCtx } from "@/features/connections/delegation";
import {
  escalationAdapter,
  gmailDraftAdapter,
  heldSendAdapter,
  type ItemState,
  type PendingFormAdapter,
  type PendingItem,
  type ReviewEdits,
} from "@/features/runtime/adapters";
import type { Ctx } from "@/lib/ctx";
import {
  AlreadyHandledError,
  ConflictError,
  ForbiddenError,
  ItemGoneError,
  SendUnconfirmedError,
  ValidationError,
} from "@/lib/errors";
import {
  REVIEW_EXPIRY_DAYS,
  reviewActions,
  reviewKinds,
  type OpenedReview,
  type PendingForms,
  type ReviewAction,
  type ReviewKind,
} from "../types";
import { handOffTo } from "./hand-off";
import { endReview, handledBy, itemOf, reviewOf, visibleReview, type ReviewRow } from "./reviews";
import { reviews } from "./schema";

const pendingForms: PendingForms = {
  approval: gmailDraftAdapter,
  escalation: escalationAdapter,
  held_send: heldSendAdapter,
};

/**
 * Opens a review the caller may see: asks its adapter where the item stands, ends the review
 * there if the item was finished in its app or is gone, and otherwise fetches it live, with
 * the colleagues the caller may hand it to.
 */
export async function openReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<OpenedReview> {
  let row = await visibleReview(ctx, reviewId);
  if (row.status === "waiting" && (await checkWaiting(ctx, row, adapters)) === "waiting") {
    try {
      const view = await adapters[row.kind].view(delegatedCtx(ctx, row.connectionId), itemOf(row));
      return { review: await reviewOf(ctx, row), view, handOffTo: await handOffTo(ctx, row) };
    } catch (error) {
      if (!(error instanceof ItemGoneError)) throw error;
      await endReview(ctx, row.id, "gone", null);
    }
  }
  if (row.status === "waiting") row = await visibleReview(ctx, row.id);
  return { review: await reviewOf(ctx, row), view: null, handOffTo: [] };
}

/**
 * Asks a waiting review's adapter where its item stands, on the review's connection, and ends
 * the review there, by nobody, when the item was finished in its app (`done_in_app`) or is
 * `gone`. Returns what the adapter said. Opening a review calls it, and so do the jobs that end
 * reviews their people finished outside Mycel (the sent-message job and the daily check), as
 * the org's system ctx.
 */
export async function checkWaiting(
  ctx: Ctx,
  row: ReviewRow,
  adapters: PendingForms = pendingForms,
): Promise<ItemState> {
  const state = await adapters[row.kind].check(delegatedCtx(ctx, row.connectionId), itemOf(row));
  if (state !== "waiting") await endReview(ctx, row.id, state, null);
  return state;
}

/**
 * Runs checkWaiting on every waiting review in the org, but ends a review of an item Mycel holds
 * (a held send) `expired` once it has waited longer than its kind allows, deleting the item
 * (ADR-0020); then has each such kind's adapter delete anything it still holds from before then,
 * such as a held send whose run stopped before its approval step. For the daily check job, as
 * the org's system ctx. A review whose app can't be asked now (a connection needing
 * reauthorization) waits on.
 */
export async function checkWaitingReviews(
  ctx: Ctx,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const now = Date.now();
  const waiting = await forOrg(ctx).select(reviews, { where: eq(reviews.status, "waiting") });
  for (const row of waiting) {
    try {
      const cutoff = expiryCutoff(row.kind, now);
      if (cutoff !== undefined && row.createdAt < cutoff) await expire(ctx, row, adapters);
      else await checkWaiting(ctx, row, adapters);
    } catch (error) {
      console.warn(`Couldn't check review ${row.id}; it waits on.`, error);
    }
  }
  for (const kind of reviewKinds) {
    const cutoff = expiryCutoff(kind, now);
    if (cutoff !== undefined) await adapters[kind].purge?.(ctx, cutoff);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// When a review of `kind` made before now expires, or undefined when the kind never does.
function expiryCutoff(kind: ReviewKind, now: number): Date | undefined {
  const days = REVIEW_EXPIRY_DAYS[kind];
  return days === undefined ? undefined : new Date(now - days * DAY_MS);
}

// Ends the review `expired`, by nobody, and deletes its item; if that fails, it waits on, to
// expire at the next check.
async function expire(ctx: Ctx, row: ReviewRow, adapters: PendingForms): Promise<void> {
  if ((await endReview(ctx, row.id, "expired", null)) === undefined) return;
  try {
    await adapters[row.kind].decline?.(delegatedCtx(ctx, row.connectionId), itemOf(row));
  } catch (error) {
    if (error instanceof ItemGoneError) return;
    await undoClaim(ctx, row, "expired", false);
    throw error;
  }
}

/** Sends the item as it was prepared. Ends the review `approved`. */
export async function approveReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "approve", adapters, (adapter, item, acting) =>
    adapter.approve(acting, item),
  );
}

/**
 * Sends the item with the caller's edits (a draft's text, or a held send's editable fields),
 * held in memory only. Ends it `edited_approved`.
 */
export async function approveEditedReview(
  ctx: Ctx,
  reviewId: string,
  edits: ReviewEdits,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  if ("text" in edits && edits.text.trim() === "") {
    throw new ValidationError("Write the reply before sending it.");
  }
  await act(ctx, reviewId, "edit", adapters, (adapter, item, acting) =>
    adapter.approve(acting, item, edits),
  );
}

/** Removes the waiting item from its app. Ends the review `declined`. */
export async function declineReview(
  ctx: Ctx,
  reviewId: string,
  adapters: PendingForms = pendingForms,
): Promise<void> {
  await act(ctx, reviewId, "decline", adapters, async (adapter, item, acting) => {
    await adapter.decline?.(acting, item);
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
  await act(ctx, reviewId, "done", adapters, (adapter, item, acting) =>
    adapter.approve(acting, item),
  );
}

const ENDINGS = {
  approve: "approved",
  edit: "edited_approved",
  decline: "declined",
  done: "done_in_app",
} as const satisfies Record<ReviewAction, string>;
type Ending = (typeof ENDINGS)[ReviewAction] | "expired";

/**
 * Claims the review by the caller with the ending `action` gives it, then carries the action
 * out through its adapter, delegated the review's connection. ValidationError when the review's
 * kind doesn't offer the action, and AlreadyHandledError (naming who handled it) when it isn't
 * waiting any more, each with nothing carried out. If carrying
 * it out fails, the claim is undone: the review waits again, or ends `gone` with its item. A
 * send its app may have carried out without confirming it ends `unconfirmed` instead, so nobody
 * can send it again (ADR-0020).
 */
async function act(
  ctx: Ctx,
  reviewId: string,
  action: ReviewAction,
  adapters: PendingForms,
  carryOut: (adapter: PendingFormAdapter, item: PendingItem, acting: Ctx) => Promise<void>,
): Promise<void> {
  const row = await visibleReview(ctx, reviewId);
  if (!(reviewActions[row.kind] as readonly ReviewAction[]).includes(action)) {
    throw new ValidationError(`This review can't be ${ACTION_WORDS[action]}.`);
  }
  const ending = ENDINGS[action];
  const claimed = await endReview(ctx, row.id, ending, ctx.userId);
  if (claimed === undefined) throw new AlreadyHandledError(await handledBy(ctx, row.id));
  try {
    await carryOut(adapters[row.kind], itemOf(row), delegatedCtx(ctx, row.connectionId));
  } catch (error) {
    if (error instanceof SendUnconfirmedError) {
      await endUnconfirmed(ctx, row, ending);
      throw new ConflictError(
        "It was approved, but its app didn't confirm it was sent, so it may have gone. Check there before sending it again yourself; the review has ended.",
      );
    }
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

// Ends a claimed review `unconfirmed`, still by whoever approved it.
async function endUnconfirmed(ctx: Ctx, row: ReviewRow, ending: Ending) {
  await forOrg(ctx).update(
    reviews,
    { status: "unconfirmed", endedAt: new Date() },
    and(eq(reviews.id, row.id), eq(reviews.status, ending)),
  );
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
