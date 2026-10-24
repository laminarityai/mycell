// Auto-pause (M8): when a run of a workflow ends failed, three counted failures in a row pause
// the workflow. The count is worked out from the workflow's runs each time, newest first, from
// its last resume or publish (workflows says which), so no counter is stored to drift; workflows
// stores the pause with the three runs, since it can't read them itself.
import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { failureStreakStart, pauseForFailures } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import type { RunStatus } from "../types";
import { NOT_THE_WORKFLOWS_FAULT } from "./failures";
import { runs, runSteps } from "./schema";

/** How many counted failures in a row pause a workflow. */
const PAUSE_AFTER = 3;

// Runs read at a time, newest first, until the streak is decided.
const PAGE = 10;

type EndedRun = Pick<typeof runs.$inferSelect, "id" | "status" | "errorCode" | "finishedAt">;

/**
 * Pauses the workflow when its last three counted runs failed, as the system ctx. Called
 * whenever one of its runs ends failed, and safe to call again: a paused workflow stays as it
 * was paused.
 */
export async function pauseIfFailing(ctx: Ctx, workflowId: string): Promise<void> {
  const since = await failureStreakStart(ctx, workflowId);
  if (since === null) return;
  const streak = await failureStreak(ctx, workflowId, since);
  if (streak.length === PAUSE_AFTER) await pauseForFailures(ctx, workflowId, streak);
}

/** Whether a run that ended `status` could pause its workflow. */
export function mayPause(status: RunStatus): boolean {
  return status === "failed" || status === "partly_failed";
}

/**
 * The newest counted failures in a row, at most PAUSE_AFTER of them, among the workflow's runs
 * that ended after `since`: up to the first run that resets the count, skipping those ignored.
 */
async function failureStreak(ctx: Ctx, workflowId: string, since: Date): Promise<string[]> {
  const streak: string[] = [];
  let after: EndedRun | undefined;
  for (;;) {
    const page = await endedRuns(ctx, workflowId, since, after);
    const codes = await failingStepCodes(
      ctx,
      page.filter((run) => mayPause(run.status)).map((run) => run.id),
    );
    for (const run of page) {
      const verdict = verdictOn(run, codes.get(run.id) ?? []);
      if (verdict === "resets") return streak;
      if (verdict === "counts") streak.push(run.id);
      if (streak.length === PAUSE_AFTER) return streak;
    }
    after = page.at(-1);
    if (page.length < PAGE || after === undefined) return streak;
  }
}

// A page of the workflow's runs that ended after `since`, newest first, from after `after`.
async function endedRuns(
  ctx: Ctx,
  workflowId: string,
  since: Date,
  after: EndedRun | undefined,
): Promise<EndedRun[]> {
  const before =
    after?.finishedAt == null
      ? undefined
      : or(
          lt(runs.finishedAt, after.finishedAt),
          and(eq(runs.finishedAt, after.finishedAt), lt(runs.id, after.id)),
        );
  return forOrg(ctx).select(runs, {
    columns: ["id", "status", "errorCode", "finishedAt"],
    where: and(eq(runs.workflowId, workflowId), gt(runs.finishedAt, since), before),
    orderBy: [desc(runs.finishedAt), desc(runs.id)],
    limit: PAGE,
  });
}

// The error codes of each run's failed steps, by run ID.
async function failingStepCodes(ctx: Ctx, runIds: string[]): Promise<Map<string, string[]>> {
  if (runIds.length === 0) return new Map();
  const rows = await forOrg(ctx).select(runSteps, {
    columns: ["runId", "errorCode"],
    where: and(
      inArray(runSteps.runId, runIds),
      inArray(runSteps.status, ["failed", "check_failed"]),
    ),
  });
  const codes = new Map<string, string[]>();
  for (const row of rows) {
    codes.set(row.runId, [...(codes.get(row.runId) ?? []), row.errorCode ?? ""]);
  }
  return codes;
}

/**
 * What a run does to the count. A failure counts, unless every failed step failed for a reason
 * of one connection's or of credits (`NOT_THE_WORKFLOWS_FAULT`), which is ignored; a run whose
 * job crashed counts. A run that succeeded, escalated or was skipped resets it; a cancelled one
 * is ignored.
 */
function verdictOn(run: EndedRun, failedStepCodes: string[]): "counts" | "resets" | "ignored" {
  switch (run.status) {
    case "succeeded":
    case "escalated":
    case "skipped":
      return "resets";
    case "cancelled":
    case "running":
      return "ignored";
    case "failed":
    case "partly_failed": {
      if (run.errorCode !== null) return "counts";
      const notItsFault =
        failedStepCodes.length > 0 &&
        failedStepCodes.every((code) => NOT_THE_WORKFLOWS_FAULT.has(code));
      return notItsFault ? "ignored" : "counts";
    }
  }
}
