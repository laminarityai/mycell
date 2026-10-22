"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { approveEditedReview, approveReview, declineReview, handOff, markDone } from "./server";

// `text` is there only when the person edited the draft, and `field:<name>` fields only when
// they edited a held send: the edits, held in memory and handed to the adapter, never stored
// (invariant 8).
const approveInput = z.object({ reviewId: z.string().min(1), text: z.string().optional() });
const FIELD = "field:";
const reviewInput = z.object({ reviewId: z.string().min(1) });
const handOffInput = z.object({ reviewId: z.string().min(1), toUserId: z.string().min(1) });

/** Approves the review, as edited when the form carries the edited text; then back to the list. */
export async function approveReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { reviewId, text } = parseForm(approveInput, form);
    const fields = Object.fromEntries(
      [...form.entries()].flatMap(([name, value]) =>
        name.startsWith(FIELD) && typeof value === "string"
          ? [[name.slice(FIELD.length), value]]
          : [],
      ),
    );
    if (text !== undefined) await approveEditedReview(ctx, reviewId, { text });
    else if (Object.keys(fields).length > 0) {
      await approveEditedReview(ctx, reviewId, { fields });
    } else await approveReview(ctx, reviewId);
  } catch (error) {
    return actionError(error);
  }
  redirect("/reviews");
}

/** Declines the review, deleting its draft; then back to the list. */
export async function declineReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { reviewId } = parseForm(reviewInput, form);
    await declineReview(ctx, reviewId);
  } catch (error) {
    return actionError(error);
  }
  redirect("/reviews");
}

/** Marks the escalation done: the person handled the message; then back to the list. */
export async function markDoneAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { reviewId } = parseForm(reviewInput, form);
    await markDone(ctx, reviewId);
  } catch (error) {
    return actionError(error);
  }
  redirect("/reviews");
}

/** Hands the review to the chosen colleague; then back to the list. */
export async function handOffReviewAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { reviewId, toUserId } = parseForm(handOffInput, form);
    await handOff(ctx, reviewId, toUserId);
  } catch (error) {
    return actionError(error);
  }
  redirect("/reviews");
}
