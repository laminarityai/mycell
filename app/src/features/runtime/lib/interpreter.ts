// The interpreter: executes a recorded run's pinned workflow version, one spec step per
// RunStep under the step's own ID, so Inngest memoizes each and a retry never repeats a
// finished one (ADR-0006). Each step checks first that the run may go on, tries its work up to
// the retry policy's attempts, records itself, and ends the run when it's the step that ends
// it. A step hands on derived data only; content stays inside the step that fetched it.
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import type { Step } from "@/features/spec/types";
import { getWorkflowVersion } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Json, RetryPolicy, RunOutcome, RunStep } from "../types";
import { checked } from "./checks";
import { stepExecutors } from "./executors";
import { isConnectionGone, RunStepError, type Failure } from "./failures";
import { defaultRetryPolicy, runInline, withRetries } from "./run-step";
import { findRun, stepsOf } from "./runs";
import { runs, runSteps } from "./schema";
import type { StepContext, StepExecution, StepRun } from "./step-context";

type Run = NonNullable<Awaited<ReturnType<typeof findRun>>>;
type Ended = RunOutcome["status"];

/** One step's result as the step state keeps it: whether it ended the run, and its output. */
type StepResult = { ended: Ended | null; output: Json };

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

  const outputs: Record<string, Json> = {};
  for (const [position, step] of spec.steps.entries()) {
    const isLast = position === spec.steps.length - 1;
    const result = await runStep(step.id, () =>
      executeStep(ctx, run, step, { position, isLast, outputs, retry }),
    );
    if (result.ended !== null) return { status: result.ended };
    outputs[step.id] = result.output;
  }
  return { status: "succeeded" };
}

type StepPlace = {
  position: number;
  isLast: boolean;
  outputs: Record<string, Json>;
  retry: RetryPolicy;
};

async function executeStep(ctx: Ctx, run: Run, step: Step, place: StepPlace): Promise<StepResult> {
  const startedAt = new Date();
  if (!(await mayGoOn(ctx, run))) return cancel(ctx, run);
  const context: StepContext = {
    ctx,
    run: {
      id: run.id,
      workflowId: run.workflowId,
      connectionId: run.connectionId,
      sourceRef: run.sourceRef,
    },
    outputs: { ...place.outputs },
  };
  const attempted = await withRetries(place.retry, () => attempt(step, context));
  try {
    if (!attempted.ok) {
      if (attempted.failure.runStatus === "cancelled") return await cancel(ctx, run);
      await recordStep(ctx, run, step, place.position, startedAt, attempted, {
        failure: attempted.failure,
      });
      await finishRun(ctx, run.id, "failed");
      return { ended: "failed", output: null };
    }
    const execution = attempted.value;
    await recordStep(ctx, run, step, place.position, startedAt, attempted, {
      execution,
    });
    const ended =
      execution.next === "continue" ? (place.isLast ? "succeeded" : null) : execution.next;
    if (ended !== null) await finishRun(ctx, run.id, ended);
    return { ended, output: execution.output };
  } catch (error) {
    if (isConnectionGone(error)) return { ended: "cancelled", output: null };
    throw error;
  }
}

/**
 * Ends the run cancelled. When the connection row is gone, the run went with it and there is
 * nothing to record; when only Nango lost it, the run row stays and shows `cancelled`.
 */
async function cancel(ctx: Ctx, run: Run): Promise<StepResult> {
  await finishRun(ctx, run.id, "cancelled");
  return { ended: "cancelled", output: null };
}

function attempt(step: Step, context: StepContext): Promise<StepExecution> {
  const executor = stepExecutors[step.type];
  if (executor.status === "pending") {
    throw new RunStepError("not_available", `The ${step.type} step isn't available yet.`);
  }
  return checked(step, () => (executor.run as StepRun<Step>)(step, context));
}

/** Whether the run may start its next step: its connection is still there. */
async function mayGoOn(ctx: Ctx, run: Run): Promise<boolean> {
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

async function finishRun(ctx: Ctx, runId: string, status: Ended): Promise<void> {
  const steps = await stepsOf(ctx, [runId]);
  const costUsd = steps.reduce((sum, step) => sum + step.costUsd, 0);
  await forOrg(ctx).update(runs, { status, costUsd, finishedAt: new Date() }, eq(runs.id, runId));
}
