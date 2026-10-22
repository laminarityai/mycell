// The interpreter: executes a recorded run's pinned workflow version, one spec step per
// RunStep under the step's own ID, so Inngest memoizes each and a retry never repeats a
// finished one (ADR-0006). The step walker decides which step runs next. Each step checks
// first that the run may go on, tries its work up to the retry policy's attempts, and records
// itself; when the walk ends, the run's status is written once. A step's output may carry
// content to later steps through the step state, which Inngest stores encrypted; its record
// keeps none (ADR-0021).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import { getActionSet } from "@/features/custom-actions/server";
import type { ActionSet } from "@/features/policy/types";
import { createReview } from "@/features/reviews/server";
import type { Spec, Step } from "@/features/spec/types";
import { getWorkflowVersion, listSwitchedOn } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RetryPolicy, RunOutcome, RunStep } from "../types";
import { actionExecutors } from "./actions";
import { holdCustomWrite } from "./custom-action";
import { linkHeldSendReview } from "./held-sends";
import { attemptStep } from "./executors";
import { isConnectionGone, type Failure } from "./failures";
import { defaultRetryPolicy, runInline, withRetries } from "./run-step";
import { findRun, stepsOf } from "./runs";
import { runs, runSteps } from "./schema";
import type { StepContext, StepExecution } from "./step-context";
import { walkSteps, type StepEnding, type StepPlace, type WalkedStep } from "./walk";

type Run = NonNullable<Awaited<ReturnType<typeof findRun>>>;
type Ended = RunOutcome["status"];

/** One step's result as the step state keeps it: whether it ended its path, and its output. */
type StepResult = WalkedStep<StepEnding>;

/**
 * The run can't go on: its switch went off or its connection went. When the connection row is
 * gone, the run went with it and there is nothing to record; when only Nango lost it, the run
 * row stays and shows `cancelled`.
 */
const CANCELLED: StepResult = { ended: "cancelled", output: null };

/**
 * Executes the run, as its org's system ctx (ADR-0009). Without a step runner each step runs
 * straight through. A run that's already finished, or gone with its connection, does nothing.
 */
export async function executeRun(
  ctx: Ctx,
  runId: string,
  runStep: RunStep = runInline,
  retry: RetryPolicy = defaultRetryPolicy,
): Promise<RunOutcome> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const run = await findRun(ctx, runId);
  if (run === undefined) return { status: "cancelled" };
  if (run.status !== "running") return { status: run.status };
  const { spec } = await getWorkflowVersion(ctx, run.workflowVersionId);
  const actionSet = await getActionSet(ctx);

  const status = await walkSteps(spec, (step, place) =>
    runStep(step.id, () => executeStep(ctx, run, step, { ...place, spec, actionSet, retry })),
  );
  // The one place a run's status is written, once the walk has ended. It's outside any step,
  // so it writes only a run still running: a retry that replays the walk changes nothing.
  await finishRun(ctx, run.id, status);
  return { status };
}

type RunPlace = StepPlace & { spec: Spec; actionSet: ActionSet; retry: RetryPolicy };

async function executeStep(ctx: Ctx, run: Run, step: Step, place: RunPlace): Promise<StepResult> {
  const startedAt = new Date();
  if (!(await mayGoOn(ctx, run))) return CANCELLED;
  const context: StepContext = {
    ctx,
    run: { id: run.id, connectionId: run.connectionId, sourceRef: run.sourceRef },
    attribution: { workflowId: run.workflowId, runId: run.id },
    spec: place.spec,
    outputs: place.outputs,
    actionSet: place.actionSet,
    actions: actionExecutors,
    holdSend: holdCustomWrite,
    awaitReview: async ({ kind, itemRef, threadRef, ...item }) => {
      const reviewId = await createReview(ctx, {
        kind,
        itemRef,
        threadRef,
        ...("reason" in item ? { reason: item.reason } : {}),
        runId: run.id,
        connectionId: "connectionId" in item ? item.connectionId : run.connectionId,
        runConnectionId: run.connectionId,
        workflowId: run.workflowId,
        workflowVersionId: run.workflowVersionId,
        sourceRef: run.sourceRef,
      });
      // A held send goes with its review.
      if (kind === "held_send") await linkHeldSendReview(ctx, itemRef, reviewId);
    },
  };
  const attempted = await withRetries(place.retry, () => attemptStep(step, context));
  try {
    if (!attempted.ok) {
      if (attempted.failure.runStatus === "cancelled") return CANCELLED;
      await recordStep(ctx, run, step, place.position, startedAt, attempted, {
        failure: attempted.failure,
      });
      // A failure ends its own path; out of credits, every path would meet it, so the run.
      const endsRun = attempted.failure.code === "out_of_credits";
      return { ended: "failed", output: null, endsRun };
    }
    const execution = attempted.value;
    await recordStep(ctx, run, step, place.position, startedAt, attempted, {
      execution,
    });
    const ended = execution.next === "continue" ? null : execution.next;
    return { ended, output: execution.output };
  } catch (error) {
    if (isConnectionGone(error)) return CANCELLED;
    throw error;
  }
}

/**
 * Whether the run may start its next step: its connection is still there, and a triggered
 * run's enablement or org switch is still on for it. Switching off takes effect here, so a step
 * already under way finishes first.
 */
async function mayGoOn(ctx: Ctx, run: Run): Promise<boolean> {
  if (run.startedBy !== "manual") {
    // Lists nothing for a connection that's gone.
    const on = await listSwitchedOn(ctx, run.connectionId);
    return on.some(({ switch: by }) =>
      run.startedBy === "enablement"
        ? by.kind === "member" && by.enablementId === run.enablementId
        : by.kind === "org" && by.workflowId === run.workflowId,
    );
  }
  try {
    await getConnection(ctx, run.connectionId);
    return true;
  } catch (error) {
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}

type StepEnd = { execution: StepExecution } | { failure: Failure };

async function recordStep(
  ctx: Ctx,
  run: Run,
  step: Step,
  position: number,
  startedAt: Date,
  tries: { attempts: number; lastAttemptAt: Date },
  end: StepEnd,
): Promise<void> {
  const common = {
    id: `${run.id}:${step.id}`,
    connectionId: run.connectionId,
    runId: run.id,
    position,
    stepId: step.id,
    type: step.type,
    attempts: tries.attempts,
    lastAttemptAt: tries.lastAttemptAt,
    startedAt,
    finishedAt: new Date(),
  };
  const values =
    "execution" in end
      ? {
          ...common,
          status: "succeeded" as const,
          output: end.execution.record,
          modelRole: end.execution.model?.role ?? null,
          modelId: end.execution.model?.modelId ?? null,
          costUsd: end.execution.model?.costUsd ?? 0,
        }
      : {
          ...common,
          status: end.failure.stepStatus,
          output: null,
          errorCode: end.failure.code,
          errorMessage: end.failure.message,
        };
  await forOrg(ctx).insert(runSteps, values, { onConflictDoNothing: true });
}

/** Ends a run still running; one an earlier invocation already ended is left as it was. */
async function finishRun(ctx: Ctx, runId: string, status: Ended): Promise<void> {
  const steps = await stepsOf(ctx, [runId]);
  const costUsd = steps.reduce((sum, step) => sum + step.costUsd, 0);
  await forOrg(ctx).update(
    runs,
    { status, costUsd, finishedAt: new Date() },
    and(eq(runs.id, runId), eq(runs.status, "running")),
  );
}
