// The step executor registry: one executor per step type, typed so that a step type without
// one fails the typecheck. Step types not built yet are pending, with the ticket that builds
// them; a run reaching one fails `not_available`.
import type { Step, StepType } from "@/features/spec/types";
import { checked } from "./checks";
import { approvalStep, draftStep } from "./draft-step";
import { RunStepError } from "./failures";
import type { Executor, StepContext, StepExecution, StepRun } from "./step-context";
import { branchStep, classifyStep, escalateStep, extractStep } from "./steps";
import { toolStep } from "./tool-step";

export const stepExecutors: { [T in StepType]: Executor<StepRun<Extract<Step, { type: T }>>> } = {
  classify: { status: "ready", run: classifyStep },
  branch: { status: "ready", run: branchStep },
  extract: { status: "ready", run: extractStep },
  tool: { status: "ready", run: toolStep },
  escalate: { status: "ready", run: escalateStep },
  draft: { status: "ready", run: draftStep },
  approval: { status: "ready", run: approvalStep },
};

/** Runs the step's executor once and checks what it gave; throws whatever failed. */
export function attemptStep(step: Step, context: StepContext): Promise<StepExecution> {
  const executor = stepExecutors[step.type];
  if (executor.status === "pending") {
    throw new RunStepError("not_available", `The ${step.type} step isn't available yet.`);
  }
  return checked(step, () => (executor.run as StepRun<Step>)(step, context));
}
