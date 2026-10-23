// Counting how reviews ended: the ship bar's measurement (docs/intent.md). Counts only, read
// from each review's status, owner, workflow version and creation time: never anything from a
// mailbox, so an admin sees a member's counts and nothing of their mail (ADR-0001). A person's
// reviews are those waiting in their own mailbox; a shared inbox's belong to nobody. No model is
// called, so nothing is debited.
import { and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { forOrg, type GroupCount } from "@/db/for-org";
import { userNames } from "@/features/orgs/server";
import type { UserNames } from "@/features/orgs/types";
import { currentVersionIds } from "@/features/workflows/server";
import { type Ctx, isAdmin, isSystem } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import {
  reviewStatuses,
  type ReviewCounts,
  type ReviewStats,
  type ReviewStatsQuery,
  type ReviewTally,
} from "../types";
import { reviews } from "./schema";

// What reviews are counted by: the Postgres groups every tally adds up.
const groupColumns = {
  workflowId: reviews.workflowId,
  workflowVersionId: reviews.workflowVersionId,
  ownerUserId: reviews.ownerUserId,
  kind: reviews.kind,
  status: reviews.status,
};
type Group = GroupCount<typeof groupColumns>;

/**
 * Counts the reviews `query` asks about. Admins (and the system ctx) may ask about anyone's and
 * count by person; a member gets their own counts, and ForbiddenError for anyone else's or for
 * counting by person.
 */
export async function reviewStats(ctx: Ctx, query: ReviewStatsQuery): Promise<ReviewStats> {
  const workflowIds = query.workflowId === undefined ? undefined : [query.workflowId];
  const { groups, nameOf } = await counted(ctx, query, workflowIds);
  return statsOf(groups, nameOf);
}

/**
 * `reviewStats` for each of these workflows, by workflow ID, counted together: the same few
 * queries for one workflow or a hundred. A workflow with no reviews has every count zero.
 */
export async function reviewStatsByWorkflow(
  ctx: Ctx,
  workflowIds: readonly string[],
  query: Omit<ReviewStatsQuery, "workflowId">,
): Promise<Map<string, ReviewStats>> {
  if (workflowIds.length === 0) return new Map();
  const { groups, nameOf } = await counted(ctx, query, [...new Set(workflowIds)]);
  const byWorkflow = Map.groupBy(groups, (group) => group.workflowId);
  return new Map(workflowIds.map((id) => [id, statsOf(byWorkflow.get(id) ?? [], nameOf)]));
}

// Whose reviews the caller may count: a member only their own, and never by person; an admin
// anyone's (undefined for everyone's).
function whose(ctx: Ctx, query: Omit<ReviewStatsQuery, "workflowId">): string | undefined {
  if (isAdmin(ctx) || isSystem(ctx)) return query.userId;
  if (query.groupBy !== undefined) throw new ForbiddenError();
  if (query.userId !== undefined && query.userId !== ctx.userId) throw new ForbiddenError();
  return ctx.userId;
}

// The groups of reviews `query` counts, of these workflows (or every one), and, when it counts
// by person, their names. Counted in the database: no review row is read.
async function counted(
  ctx: Ctx,
  query: Omit<ReviewStatsQuery, "workflowId">,
  workflowIds: string[] | undefined,
): Promise<{ groups: Group[]; nameOf: UserNames | undefined }> {
  const userId = whose(ctx, query);
  const where: SQL[] = [];
  if (workflowIds !== undefined) where.push(inArray(reviews.workflowId, workflowIds));
  if (userId !== undefined) where.push(eq(reviews.ownerUserId, userId));
  if (query.since instanceof Date) where.push(gte(reviews.createdAt, query.since));
  const [groups, nameOf] = await Promise.all([
    forOrg(ctx).countBy(reviews, groupColumns, and(...where)),
    query.groupBy === "user" ? userNames(ctx) : undefined,
  ]);
  if (query.since !== "current_version") return { groups, nameOf };
  const current = await currentVersionIds(
    ctx,
    groups.map((group) => group.workflowId),
  );
  return {
    groups: groups.filter((group) => current.get(group.workflowId) === group.workflowVersionId),
    nameOf,
  };
}

// The groups' tally, and with `nameOf` each person's apart: people by name, then the shared
// inbox.
function statsOf(groups: Group[], nameOf: UserNames | undefined): ReviewStats {
  if (nameOf === undefined) return { ...tally(groups), byUser: [] };
  const owners = [...new Set(groups.map((group) => group.ownerUserId))];
  const byUser = owners
    .map((owner) => ({
      user: owner === null ? null : { id: owner, name: nameOf(owner) },
      ...tally(groups.filter((group) => group.ownerUserId === owner)),
    }))
    .sort((a, b) =>
      a.user === null ? 1 : b.user === null ? -1 : a.user.name.localeCompare(b.user.name),
    );
  return { ...tally(groups), byUser };
}

function tally(groups: Group[]): ReviewTally {
  const approvals = countsOf(groups.filter((group) => group.kind === "approval"));
  const { approved, edited_approved, declined, gone } = approvals;
  const ended = approved + edited_approved + declined + gone;
  return {
    approvals,
    escalations: countsOf(groups.filter((group) => group.kind === "escalation")),
    heldSends: countsOf(groups.filter((group) => group.kind === "held_send")),
    meetings: countsOf(groups.filter((group) => group.kind === "calendar_event")),
    approvedWithoutEdits: ended === 0 ? null : approved / ended,
  };
}

function countsOf(groups: Group[]): ReviewCounts {
  const counts = Object.fromEntries(reviewStatuses.map((status) => [status, 0])) as ReviewCounts;
  for (const group of groups) counts[group.status] += group.count;
  return counts;
}
