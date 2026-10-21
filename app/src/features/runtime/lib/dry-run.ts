// A dry run ("Try it"): the interpreter's steps on one real message, in memory, without Inngest
// and without a run record. Model and read steps run for real; every action that would change
// an app is a stub (dry-run-actions.ts); a review the spec or the policy engine asks for is
// reported as one it would wait for, and the run goes on. The result, content and all, goes
// back to the admin who asked and is never stored (invariant 8). Model calls pass the credit
// check and are recorded, marked as a dry run's (invariant 7).
import { randomUUID } from "node:crypto";
import { requireBuildableConnection } from "@/features/connections/server";
import { eachStep } from "@/features/spec/tree";
import type { Spec, Step } from "@/features/spec/types";
import { checkWorkflowSpec } from "@/features/workflows/server";
import { checkCredits } from "@/features/credits/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { OutOfCreditsError, SpecInvalidError } from "@/lib/errors";
import type { DryRunEffect, DryRunResult, DryRunStep, Json } from "../types";
import { CREDIT_ESTIMATES } from "./call-model";
import { checked } from "./checks";
import { dryRunActions } from "./dry-run-actions";
import { stepExecutors } from "./executors";
import { describeFailure, RunStepError } from "./failures";
import type { StepContext, StepExecution, StepRun } from "./step-context";

export type DryRunOptions = {
  connectionId: string;
  /** The Gmail message to try it on. */
  sourceRef: string;
  /** The workflow it's the working spec of, for the ledger; none for a new workflow. */
  workflowId?: string;
};

/**
 * Tries `spec` on one message of the admin's own or an org connection. Throws SpecInvalidError
 * for a spec saving would refuse, NotFoundError for any other member's connection, and
 * OutOfCreditsError, before anything runs, when the balance can't cover its model steps.
 */
export async function dryRun(ctx: Ctx, spec: unknown, options: DryRunOptions) {
  requireAdmin(ctx);
  const validated = await checkWorkflowSpec(ctx, spec);
  if (!validated.ok) throw new SpecInvalidError(validated.issues);
  // One a run of the spec could use: the admin's own for member credentials, an org
  // connection for org credentials, granted Gmail.
  await requireBuildableConnection(ctx, options.connectionId, validated.working.credentials);
  await preflight(ctx, validated.applied);

  const inserted = new Set(validated.inserted.map((approval) => approval.stepId));
  const runId = `dry-run-${randomUUID()}`;
  const outputs: Record<string, Json> = {};
  const steps: DryRunStep[] = [];
  // What the step running now read or would have written, as its stub reports it.
  const current: { effect: DryRunEffect | null } = { effect: null };
  const actions = dryRunActions((effect) => {
    current.effect = effect;
  });
  let ended: DryRunResult["ended"] = "succeeded";
  for (const step of validated.applied.steps) {
    current.effect = null;
    const context: StepContext = {
      ctx,
      run: { id: runId, connectionId: options.connectionId, sourceRef: options.sourceRef },
      attribution: { workflowId: options.workflowId, dryRun: true },
      spec: validated.applied,
      outputs: { ...outputs },
      actions,
    };
    const base = { stepId: step.id, type: step.type, insertedByPolicy: inserted.has(step.id) };
    let execution: StepExecution;
    try {
      execution = await attempt(step, context);
    } catch (error) {
      // Out of credits part-way: refused, like out of credits at the start.
      if (error instanceof OutOfCreditsError) throw error;
      const failure = describeFailure(error);
      steps.push({
        ...base,
        status: failure.stepStatus,
        output: null,
        effect: null,
        error: { code: failure.code, message: failure.message },
        modelId: null,
        costUsd: 0,
      });
      ended = "failed";
      break;
    }
    steps.push({
      ...base,
      status: "succeeded",
      output: execution.output,
      effect: step.type === "approval" ? { kind: "review", channel: step.channel } : current.effect,
      error: null,
      modelId: execution.model?.modelId ?? null,
      costUsd: execution.model?.costUsd ?? 0,
    });
    outputs[step.id] = execution.output;
    if (execution.next !== "continue") {
      ended = execution.next;
      break;
    }
  }
  const costUsd = steps.reduce((sum, step) => sum + step.costUsd, 0);
  return { ended, steps, costUsd } satisfies DryRunResult;
}

function attempt(step: Step, context: StepContext): Promise<StepExecution> {
  const executor = stepExecutors[step.type];
  if (executor.status === "pending") {
    throw new RunStepError("not_available", `The ${step.type} step isn't available yet.`);
  }
  return checked(step, () => (executor.run as StepRun<Step>)(step, context));
}

/** Refuses up front when the balance can't cover the dearest of the spec's model steps. */
async function preflight(ctx: Ctx, spec: Spec): Promise<void> {
  const estimates = eachStep(spec).flatMap(({ step }) =>
    "role" in step ? [CREDIT_ESTIMATES[step.role]] : [],
  );
  if (estimates.length > 0) await checkCredits(ctx, Math.max(...estimates));
}
