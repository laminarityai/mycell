// Counting how reviews ended: the ship bar's measurement (docs/intent.md). Counts only, read
// from each review's status, owner, workflow version and creation time: never anything from a
// mailbox, so an admin sees a member's counts and nothing of their mail (ADR-0001). A person's
// reviews are those waiting in their own mailbox; a shared inbox's belong to nobody. No model is
// called, so nothing is debited.
import { and, eq, gte, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { userNames } from "@/features/orgs/server";
import { currentVersionIds } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import {
  reviewStatuses,
  type ReviewCounts,
  type ReviewStats,
  type ReviewStatsQuery,
  type ReviewTally,
} from "../types";
import type { ReviewRow } from "./reviews";
import { reviews } from "./schema";

/**
 * Counts the reviews `query` asks about. Admins (and the system ctx) may ask about anyone's and
 * count by person; a member gets their own counts, and ForbiddenError for anyone else's or for
 * counting by person.
 */
export async function reviewStats(ctx: Ctx, query: ReviewStatsQuery): Promise<ReviewStats> {
  const userId = whose(ctx, query);
  const rows = await counted(ctx, query, userId);
  if (query.groupBy !== "user") return { ...tally(rows), byUser: [] };
  const nameOf = await userNames(ctx);
  const owners = [...new Set(rows.map((row) => row.ownerUserId))];
  const byUser = owners
    .map((owner) => ({
      user: owner === null ? null : { id: owner, name: nameOf(owner) },
      ...tally(rows.filter((row) => row.ownerUserId === owner)),
    }))
    // People by name, then the shared inbox.
    .sort((a, b) =>
      a.user === null ? 1 : b.user === null ? -1 : a.user.name.localeCompare(b.user.name),
    );
  return { ...tally(rows), byUser };
}

// Whose reviews the caller may count: a member only their own, and never by person; an admin
// anyone's (undefined for everyone's).
function whose(ctx: Ctx, query: ReviewStatsQuery): string | undefined {
  if (ctx.role === "admin" || ctx.role === "system") return query.userId;
  if (query.groupBy !== undefined) throw new ForbiddenError();
  if (query.userId !== undefined && query.userId !== ctx.userId) throw new ForbiddenError();
  return ctx.userId;
}

async function counted(
  ctx: Ctx,
  query: ReviewStatsQuery,
  userId: string | undefined,
): Promise<ReviewRow[]> {
  const where: SQL[] = [];
  if (query.workflowId !== undefined) where.push(eq(reviews.workflowId, query.workflowId));
  if (userId !== undefined) where.push(eq(reviews.ownerUserId, userId));
  if (query.since instanceof Date) where.push(gte(reviews.createdAt, query.since));
  const rows = await forOrg(ctx).select(reviews, { where: and(...where) });
  if (query.since !== "current_version") return rows;
  const current = await currentVersionIds(
    ctx,
    rows.map((row) => row.workflowId),
  );
  return rows.filter((row) => current.get(row.workflowId) === row.workflowVersionId);
}

function tally(rows: ReviewRow[]): ReviewTally {
  const approvals = countsOf(rows.filter((row) => row.kind === "approval"));
  const { approved, edited_approved, declined, gone } = approvals;
  const ended = approved + edited_approved + declined + gone;
  return {
    approvals,
    escalations: countsOf(rows.filter((row) => row.kind === "escalation")),
    approvedWithoutEdits: ended === 0 ? null : approved / ended,
  };
}

function countsOf(rows: ReviewRow[]): ReviewCounts {
  const counts = Object.fromEntries(reviewStatuses.map((status) => [status, 0])) as ReviewCounts;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
