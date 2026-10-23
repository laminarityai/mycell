// One run, for its page: its steps, the version it ran and the path it took, by the Runs page's
// rules (ADR-0001). An admin sees every run in the org, a member the runs on their own member
// connection; a run is shown in full only to its connection's readers, and redacted to anyone
// else (no source ref, nothing a step handed on). The same queries however many steps it has.
import { env } from "@/env";
import { getActionSet } from "@/features/custom-actions/server";
import { checkWords } from "@/features/policy/condition-fields";
import { describePathTo } from "@/features/spec/describe";
import { findStep } from "@/features/spec/tree";
import { versionsById, workflowNames } from "@/features/workflows/server";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RunMessage, RunRecord, RunStepRecord } from "../types";
import { inboxOf, visibleRuns } from "./run-list";
import { messagesOf } from "./run-messages";
import { stepChecks, runTrace } from "./run-trace";
import { findRun, stepsOf } from "./runs";

/**
 * The run with its steps, its version and its path, as the caller may see it: in full on a
 * connection they read, redacted on a colleague's (admins only). ForbiddenError for a member
 * asking for a run that isn't on their own inbox; NotFoundError for one not in the org.
 */
export async function getRun(ctx: Ctx, runId: string): Promise<RunRecord> {
  requireRole(ctx, "admin", "member");
  const [{ owners }, run] = await Promise.all([visibleRuns(ctx), findRun(ctx, runId)]);
  if (run === undefined) throw new NotFoundError("run");
  const owner = owners.get(run.connectionId);
  const own = owner?.kind === "member" && owner.readable;
  if (!isAdmin(ctx) && !own) throw new ForbiddenError();
  const full = owner?.readable === true;
  const [rows, versions, names, actions] = await Promise.all([
    stepsOf(ctx, [run.id]),
    versionsById(ctx, [run.workflowVersionId]),
    workflowNames(ctx, [run.workflowId]),
    // What each check of a path tests, in the editor's words: only for a run shown in full.
    full ? getActionSet(ctx) : null,
  ]);
  const version = versions.get(run.workflowVersionId);
  const spec = version?.spec;
  const steps = rows.map((row): RunStepRecord => ({
    stepId: row.stepId,
    type: row.type,
    path: spec === undefined ? null : describePathTo(spec, row.stepId),
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    output: full ? (row.output ?? null) : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    modelRole: row.modelRole,
    modelId: row.modelId,
    costUsd: row.costUsd,
    costCredits: row.costUsd * env.CREDITS_PER_USD,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    checks: stepChecks(spec === undefined ? undefined : findStep(spec, row.stepId), row),
  }));
  // Built from the records before they're redacted: a branch's record names the paths it took.
  const words = spec === undefined || actions === null ? null : checkWords(spec, actions);
  const trace = runTrace(
    spec,
    rows.map((row) => ({ stepId: row.stepId, status: row.status, output: row.output ?? null })),
    words,
  );
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: names.get(run.workflowId) ?? "Deleted workflow",
    workflowVersionId: run.workflowVersionId,
    version:
      version === undefined ? null : { id: version.id, number: version.number, spec: version.spec },
    connectionId: run.connectionId,
    ownerScope: run.ownerScope,
    enablementId: run.enablementId,
    startedBy: run.startedBy,
    inbox: inboxOf(owner),
    full,
    sourceRef: full ? run.sourceRef : null,
    status: run.status,
    errorCode: run.errorCode,
    costUsd: run.costUsd,
    costCredits: run.costUsd * env.CREDITS_PER_USD,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    steps,
    trace,
  };
}

/**
 * The message or invite the run started from, fetched from its app for display only, with where
 * it opens there; null unless the caller reads the run's connection (its owner, or an admin for an org
 * connection). NotFoundError for a run not in the org.
 */
export async function getRunMessage(ctx: Ctx, runId: string): Promise<RunMessage | null> {
  requireRole(ctx, "admin", "member");
  const run = await findRun(ctx, runId);
  if (run === undefined) throw new NotFoundError("run");
  const version = (await versionsById(ctx, [run.workflowVersionId])).get(run.workflowVersionId);
  const trigger = version?.spec.trigger.type ?? "gmail.message_received";
  return (await messagesOf(ctx, [{ ...run, trigger }])).get(run.id) ?? null;
}
