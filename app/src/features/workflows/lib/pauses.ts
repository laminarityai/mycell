// The one pause model (M7): what pauses a switch, worked out the same way for the trigger's
// fan-out and for every page that shows a switch. A switch's own stored pause (an enablement
// waiting for its user's OK) joins what holds over its workflow, read from the ledger when it's
// needed: nothing is written when one of those starts or ends, so a grant lifts it at once.
import { isOutOfCredits } from "@/features/credits/server";
import type { Ctx } from "@/lib/ctx";
import {
  type EnablementStatus,
  PAUSED_REASONS,
  type PausedReason,
  type StoredPausedReason,
} from "../types";

/**
 * What holds over a workflow besides its switch's own pause. M7's budgets add whether the
 * workflow has spent its month's budget, and M8 whether it's paused after failures.
 */
export type WorkflowHolds = { outOfCredits: boolean };

/** What a switch stores about its own pause: an enablement's row, or nothing for an org switch. */
export type StoredPause = { status: EnablementStatus; pausedReason: StoredPausedReason | null };

/**
 * Every pause that holds on a switch, in `PAUSED_REASONS`' order: the first is its effective
 * state, and an empty list means it runs.
 */
export function pausesOf(stored: StoredPause | null, holds: WorkflowHolds): PausedReason[] {
  const holding = new Set<PausedReason>();
  if (holds.outOfCredits) holding.add("out_of_credits");
  if (stored?.status === "paused" && stored.pausedReason !== null) {
    holding.add(stored.pausedReason);
  }
  return PAUSED_REASONS.filter((reason) => holding.has(reason));
}

const NOTHING_HOLDS: WorkflowHolds = { outOfCredits: false };

/**
 * What holds over each of `workflowIds`, by workflow ID, read in the same queries however many
 * there are (none when there are none). Out of credits holds over every workflow in the org.
 */
export async function readHolds(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<(workflowId: string) => WorkflowHolds> {
  if (workflowIds.length === 0) return () => NOTHING_HOLDS;
  const holds: WorkflowHolds = { outOfCredits: await isOutOfCredits(ctx) };
  return () => holds;
}
