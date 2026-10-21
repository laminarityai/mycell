// Creating reviews and finding the ones the caller may see. Who sees a review: a member's review
// only its owner (ADR-0001), so admins never read members' mail; an org review, until shared
// reviews arrive (#65), only admins. Anything else is "not found", as is another org's.
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import type { PendingItem } from "@/features/runtime/adapters";
import { workflowNames } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { NewReview, Review, ReviewSummary } from "../types";
import { reviews } from "./schema";

export type ReviewRow = typeof reviews.$inferSelect;

/**
 * Records a `waiting` review of an item a run prepared, owned as the run's connection is: a
 * member connection's by its owner, an org connection's by the org. Called by a run's step, as
 * the org's system ctx, inside the step: one item of one run makes one review, however often
 * the step is retried.
 */
export async function createReview(ctx: Ctx, review: NewReview): Promise<void> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const connection = await getConnection(ctx, review.connectionId);
  await forOrg(ctx).insert(
    reviews,
    {
      ...review,
      id: randomUUID(),
      ownerScope: connection.kind,
      ownerUserId: connection.kind === "member" ? connection.ownerUserId : null,
    },
    { onConflictDoNothing: true },
  );
}

/** The caller's waiting reviews, oldest first, with each one's workflow's name. */
export async function listReviews(ctx: Ctx): Promise<ReviewSummary[]> {
  const rows = (
    await forOrg(ctx).select(reviews, {
      where: eq(reviews.status, "waiting"),
      orderBy: [asc(reviews.createdAt), asc(reviews.id)],
    })
  ).filter((row) => isVisibleTo(ctx, row));
  const names = await workflowNames(
    ctx,
    rows.map((row) => row.workflowId),
  );
  return rows.map((row) => summaryOf(row, names.get(row.workflowId)));
}

/** One review the caller may see; NotFoundError for any other, another org's included. */
export async function visibleReview(ctx: Ctx, reviewId: string): Promise<ReviewRow> {
  const row = (await forOrg(ctx).select(reviews, { where: eq(reviews.id, reviewId) })).at(0);
  if (row === undefined || !isVisibleTo(ctx, row)) throw new NotFoundError("review");
  return row;
}

/**
 * Whether the caller may see and act on a review: its owner for a member's, admins for an org's.
 * The system ctx, which jobs act as, sees every review in its org (ADR-0009). #65 adds the
 * colleague a review was handed to, and an org review's tags.
 */
function isVisibleTo(ctx: Ctx, row: ReviewRow): boolean {
  if (ctx.role === "system") return true;
  return row.ownerScope === "member" ? row.ownerUserId === ctx.userId : ctx.role === "admin";
}

/** The review as its row now stands, with its workflow's name. */
export async function reviewOf(ctx: Ctx, row: ReviewRow): Promise<Review> {
  const names = await workflowNames(ctx, [row.workflowId]);
  return {
    ...summaryOf(row, names.get(row.workflowId)),
    reason: row.reason,
    status: row.status,
    endedByUserId: row.endedByUserId,
    endedAt: row.endedAt,
  };
}

/** Where the review's item waits, as its adapter takes it. */
export function itemOf(row: ReviewRow): PendingItem {
  return {
    connectionId: row.connectionId,
    itemRef: row.itemRef,
    threadRef: row.threadRef,
    sourceRef: row.sourceRef,
    createdAt: row.createdAt,
  };
}

/** Ends a review still waiting as `status`; the row as it then stands, or undefined if not. */
export async function endReview(
  ctx: Ctx,
  reviewId: string,
  status: Exclude<ReviewRow["status"], "waiting">,
  endedByUserId: string | null,
): Promise<ReviewRow | undefined> {
  const ended = await forOrg(ctx).update(
    reviews,
    { status, endedByUserId, endedAt: new Date() },
    and(eq(reviews.id, reviewId), eq(reviews.status, "waiting")),
  );
  return ended.at(0);
}

function summaryOf(row: ReviewRow, workflowName = "A deleted workflow"): ReviewSummary {
  return {
    id: row.id,
    kind: row.kind,
    workflowId: row.workflowId,
    workflowName,
    createdAt: row.createdAt,
  };
}
