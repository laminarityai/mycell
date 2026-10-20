// A tool step: resolve its input's references, then run its catalog action, which checks the
// input and the output against the catalog's schemas.
import type { Step } from "@/features/spec/types";
import { resolveInput } from "./references";
import { runAction } from "./run-action";
import type { StepContext, StepExecution } from "./step-context";

type ToolStep = Extract<Step, { type: "tool" }>;

export async function toolStep(step: ToolStep, context: StepContext): Promise<StepExecution> {
  const input = await resolveInput(context, step.input);
  const value = await runAction(step.action, input, step.id, context);
  return { next: "continue", output: value, record: value };
}
