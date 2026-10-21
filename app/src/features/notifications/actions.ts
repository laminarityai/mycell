"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, ValidationError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { setReviewDigest, unsubscribeWithLink } from "./server";

/** Turns the caller's daily review digest on or off, from the switch on the Reviews page. */
export async function setReviewDigestAction(on: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const parsed = z.boolean().safeParse(on);
    if (!parsed.success) throw new ValidationError("Reload the page and try again.");
    await setReviewDigest(ctx, parsed.data);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

const unsubscribeInput = z.object({ token: z.string() });

/**
 * Turns the review digest off for the person the email's signed link names. No sign-in: the
 * link vouches for them.
 */
export async function unsubscribeAction(
  _previous: ActionResult & { done?: boolean },
  form: FormData,
): Promise<ActionResult & { done?: boolean }> {
  try {
    await unsubscribeWithLink(parseForm(unsubscribeInput, form).token);
  } catch (error) {
    return actionError(error);
  }
  return { done: true };
}
