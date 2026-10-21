// Creating reviews and finding the ones the caller may see. Who sees a review: a member's review
// only its owner (ADR-0001), so admins never read members' mail; an org review everyone who sees
// its workflow through its tags, and every admin (ADR-0013); and either one the colleague it was
// handed to. Tags are read on every call, so losing one hides its org reviews at once. Anything
// else is "not found", as is another org's.
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import { listUsers } from "@/features/orgs/server";
import type { PendingItem } from "@/features/runtime/adapters";
import type { ReviewSharing } from "@/features/workflows/types";
import { reviewSharing, workflowNames } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { HandOff, NewReview, Review, ReviewSummary } from "../types";
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

/**
 * The caller's waiting reviews, oldest first, with each one's workflow's name, and for an org
 * review the tags it's shared with.
 */
export async function listReviews(ctx: Ctx): Promise<ReviewSummary[]> {
  const rows = await waitingFor(ctx);
  const names = await workflowNames(
    ctx,
    rows.map((row) => row.workflowId),
  );
  const users = rows.some((row) => row.handedToUserId !== null)
    ? await userNames(ctx)
    : new Map<string, string>();
  const sharing = await sharingOf(ctx, rows);
  return rows.map((row) => summaryOf(row, users, sharing, names.get(row.workflowId)));
}

/**
 * How many reviews wait for the caller: those `listReviews` lists, counted the same way, for the
 * app's navigation.
 */
export async function countWaitingReviews(ctx: Ctx): Promise<number> {
  return (await waitingFor(ctx)).length;
}

/** The waiting reviews the caller may see, oldest first. */
async function waitingFor(ctx: Ctx): Promise<ReviewRow[]> {
  return visibleOf(
    ctx,
    await forOrg(ctx).select(reviews, {
      where: eq(reviews.status, "waiting"),
      orderBy: [asc(reviews.createdAt), asc(reviews.id)],
    }),
  );
}

/** One review the caller may see; NotFoundError for any other, another org's included. */
export async function visibleReview(ctx: Ctx, reviewId: string): Promise<ReviewRow> {
  const rows = await forOrg(ctx).select(reviews, { where: eq(reviews.id, reviewId) });
  const row = (await visibleOf(ctx, rows)).at(0);
  if (row === undefined) throw new NotFoundError("review");
  return row;
}

/**
 * The rows the caller may see and act on: a member's review its owner's, an org review that of
 * whoever sees its workflow now (every admin included), and either the colleague it was handed
 * to. The system ctx, which jobs act as, sees every review in its org (ADR-0009).
 */
async function visibleOf(ctx: Ctx, rows: ReviewRow[]): Promise<ReviewRow[]> {
  if (ctx.role === "system") return rows;
  // An admin sees every org review; anyone else those of workflows they see through a tag.
  const sharing =
    ctx.role === "admin" ? new Map<string, ReviewSharing>() : await sharingOf(ctx, rows);
  return rows.filter((row) => {
    if (row.handedToUserId === ctx.userId) return true;
    if (row.ownerScope === "member") return row.ownerUserId === ctx.userId;
    return ctx.role === "admin" || sharing.get(row.workflowId)?.seen === true;
  });
}

// How the org reviews among `rows` are shared, by workflow ID: who sees them, and with which tags.
async function sharingOf(ctx: Ctx, rows: ReviewRow[]): Promise<Map<string, ReviewSharing>> {
  const org = rows.filter((row) => row.ownerScope === "org");
  if (org.length === 0) return new Map();
  return reviewSharing(
    ctx,
    org.map((row) => row.workflowId),
  );
}

/** The review as its row now stands, with its workflow's name and the names of its people. */
export async function reviewOf(ctx: Ctx, row: ReviewRow): Promise<Review> {
  const names = await workflowNames(ctx, [row.workflowId]);
  const users = await userNames(ctx);
  const sharing = await sharingOf(ctx, [row]);
  return {
    ...summaryOf(row, users, sharing, names.get(row.workflowId)),
    reason: row.reason,
    status: row.status,
    endedByUserId: row.endedByUserId,
    endedBy: row.endedByUserId === null ? null : nameOf(users, row.endedByUserId),
    endedAt: row.endedAt,
  };
}

/**
 * The name of whoever ended the review in Mycel, read now: for AlreadyHandledError to say who
 * acted first. Undefined while it waits, or when nobody in Mycel ended it.
 */
export async function handledBy(ctx: Ctx, reviewId: string): Promise<string | undefined> {
  const row = (await forOrg(ctx).select(reviews, { where: eq(reviews.id, reviewId) })).at(0);
  if (row?.endedByUserId == null) return undefined;
  return nameOf(await userNames(ctx), row.endedByUserId);
}

/** The org's users' names, by user ID. */
export async function userNames(ctx: Ctx): Promise<Map<string, string>> {
  return new Map((await listUsers(ctx)).map((user) => [user.id, user.name]));
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

function summaryOf(
  row: ReviewRow,
  users: Map<string, string>,
  sharing: Map<string, ReviewSharing>,
  workflowName = "A deleted workflow",
): ReviewSummary {
  return {
    id: row.id,
    kind: row.kind,
    workflowId: row.workflowId,
    workflowName,
    sharedWith: row.ownerScope === "org" ? (sharing.get(row.workflowId)?.tags ?? []) : null,
    handOff: handOffOf(row, users),
    createdAt: row.createdAt,
  };
}

function handOffOf(row: ReviewRow, users: Map<string, string>): HandOff | null {
  const { handedToUserId: to, handedByUserId: by } = row;
  if (to === null || by === null) return null;
  return { to: { id: to, name: nameOf(users, to) }, by: { id: by, name: nameOf(users, by) } };
}

// A user who has left the org keeps no name here.
function nameOf(users: Map<string, string>, userId: string): string {
  return users.get(userId) ?? "someone no longer in the org";
}
