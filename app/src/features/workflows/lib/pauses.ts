// The one pause model (M7): what pauses a switch, worked out the same way for the trigger's
// fan-out and for every page that shows a switch. A switch's own stored pause (an enablement
// waiting for its user's OK) joins what holds over its workflow, read from the ledger when it's
// needed: nothing is written when one of those starts or ends, so a grant, a new month or a
// published budget lifts it at once.
import { budgetsReached, isOutOfCredits } from "@/features/credits/server";
import type { Ctx } from "@/lib/ctx";
import {
  type EnablementStatus,
  PAUSED_REASONS,
  type PausedReason,
  type StoredPausedReason,
} from "../types";
import { latestVersions } from "./latest-versions";

/**
 * What holds over a workflow besides its switch's own pause: the company being out of credits,
 * and the workflow having spent its month's budget. M8 adds whether it's paused after failures.
 */
export type WorkflowHolds = { outOfCredits: boolean; budgetReached: boolean };

/** What a switch stores about its own pause: an enablement's row, or nothing for an org switch. */
export type StoredPause = { status: EnablementStatus; pausedReason: StoredPausedReason | null };

/**
 * Every pause that holds on a switch, in `PAUSED_REASONS`' order: the first is its effective
 * state, and an empty list means it runs.
 */
export function pausesOf(stored: StoredPause | null, holds: WorkflowHolds): PausedReason[] {
  const holding = new Set<PausedReason>();
  if (holds.outOfCredits) holding.add("out_of_credits");
  if (holds.budgetReached) holding.add("budget_reached");
  if (stored?.status === "paused" && stored.pausedReason !== null) {
    holding.add(stored.pausedReason);
  }
  return PAUSED_REASONS.filter((reason) => holding.has(reason));
}

const NOTHING_HOLDS: WorkflowHolds = { outOfCredits: false, budgetReached: false };

/**
 * What holds over each of `workflowIds`, by workflow ID, read in the same queries however many
 * there are (none when there are none). Out of credits holds over every workflow in the org; a
 * budget is its latest version's, and only a workflow with one has its spending read.
 */
export async function readHolds(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<(workflowId: string) => WorkflowHolds> {
  if (workflowIds.length === 0) return () => NOTHING_HOLDS;
  const [outOfCredits, latest] = await Promise.all([
    isOutOfCredits(ctx),
    latestVersions(ctx, [...new Set(workflowIds)]),
  ]);
  const budgets = new Map(
    [...latest].flatMap(([workflowId, version]) => {
      const budget = version.spec.budget?.monthlyCredits;
      return budget === undefined ? [] : [[workflowId, budget] as const];
    }),
  );
  const reached = await budgetsReached(ctx, budgets);
  return (workflowId) => ({ outOfCredits, budgetReached: reached.has(workflowId) });
}
