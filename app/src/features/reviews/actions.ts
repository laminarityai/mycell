"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runFormAction } from "@/features/orgs/form-action";
import type { ActionResult } from "@/lib/errors";
import { approveEditedReview, approveReview, declineReview, handOff, markDone } from "./server";
import { approveFormSchema } from "./types";

const reviewInput = z.object({ reviewId: z.string().min(1) });
const handOffInput = z.object({ reviewId: z.string().min(1), toUserId: z.string().min(1) });

const backToList = () => redirect("/reviews");

/** Approves the review, as edited when the form carries the edited text; then back to the list. */
export async function approveReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  // The edits are held in memory and handed to the adapter, never stored (invariant 8). A
  // refusal hands them back to the form that sent them, so they aren't lost.
  return runFormAction(
    form,
    approveFormSchema,
    (ctx, { reviewId, edits }) =>
      edits === undefined
        ? approveReview(ctx, reviewId)
        : approveEditedReview(ctx, reviewId, edits),
    { after: backToList },
  );
}

/** Declines the review, deleting its draft; then back to the list. */
export async function declineReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, reviewInput, (ctx, { reviewId }) => declineReview(ctx, reviewId), {
    after: backToList,
  });
}

/** Marks the escalation done: the person handled the message; then back to the list. */
export async function markDoneAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, reviewInput, (ctx, { reviewId }) => markDone(ctx, reviewId), {
    after: backToList,
  });
}

/** Hands the review to the chosen colleague; then back to the list. */
export async function handOffReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    handOffInput,
    (ctx, { reviewId, toUserId }) => handOff(ctx, reviewId, toUserId),
    { after: backToList },
  );
}
