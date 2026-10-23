// Handing a review on (ADR-0013): when the workflow's latest version allows it, whoever may hand
// a review on gives it to a colleague in the org, who then sees it and acts on it through the
// review's own connection. A member's own review is handed on by that member alone, since only
// they may choose to show their mail to someone (ADR-0001); an org review by anyone who sees it.
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import { reviewSharing } from "@/features/workflows/server";
import { type Ctx, isSystem } from "@/lib/ctx";
import { AlreadyHandledError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ReviewPerson } from "../types";
import { handledBy, visibleReview, type ReviewRow } from "./reviews";
import { reviews } from "./schema";

/**
 * Hands a waiting review the caller may see to `toUserId`, a user in the caller's org; the
 * colleague it was handed to before, if any, no longer sees it through the hand-off.
 * NotFoundError for a review the caller can't see or a user not in the org; ForbiddenError when
 * the caller may not hand it on (not a member review's owner, or the workflow doesn't allow it);
 * ValidationError for the caller themselves; AlreadyHandledError once it has ended.
 */
export async function handOff(ctx: Ctx, reviewId: string, toUserId: string): Promise<void> {
  const row = await visibleReview(ctx, reviewId);
  if (!(await mayHandOn(ctx, row))) throw new ForbiddenError();
  if (!(await listUsers(ctx)).some((user) => user.id === toUserId)) {
    throw new NotFoundError("user");
  }
  if (toUserId === ctx.userId) throw new ValidationError("Hand it to a colleague, not yourself.");
  const handed = await forOrg(ctx).update(
    reviews,
    { handedToUserId: toUserId, handedByUserId: ctx.userId },
    and(eq(reviews.id, row.id), eq(reviews.status, "waiting")),
  );
  if (handed.length === 0) throw new AlreadyHandledError(await handledBy(ctx, row.id));
}

/**
 * The colleagues the caller may hand a review they see to: everyone else in the org but whoever
 * has it now, or nobody when they may not hand it on.
 */
export async function handOffTo(ctx: Ctx, row: ReviewRow): Promise<ReviewPerson[]> {
  if (row.status !== "waiting" || !(await mayHandOn(ctx, row))) return [];
  return (await listUsers(ctx))
    .filter((user) => user.id !== ctx.userId && user.id !== row.handedToUserId)
    .map(({ id, name }) => ({ id, name }));
}

// Whether the caller, who sees the review, may hand it on: a user (not a job), its owner for a
// member's review, and only while the workflow's latest version allows hand-off.
async function mayHandOn(ctx: Ctx, row: ReviewRow): Promise<boolean> {
  if (isSystem(ctx)) return false;
  if (row.ownerScope === "member" && row.ownerUserId !== ctx.userId) return false;
  return (await reviewSharing(ctx, [row.workflowId])).get(row.workflowId)?.handOff === true;
}
