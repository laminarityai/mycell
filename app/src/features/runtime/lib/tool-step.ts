// A tool step: resolve its input's references, then run its catalog action, which checks the
// input and the output against the catalog's schemas. A memory lookup's record keeps only its
// count: the facts it found are its member's (ADR-0001).
import type { Step } from "@/features/spec/types";
import { lookupRecord, MEMORY_LOOKUP } from "./memory-lookup";
import { resolveInput } from "./references";
import { runAction } from "./run-action";
import type { StepContext, StepExecution } from "./step-context";

type ToolStep = Extract<Step, { type: "tool" }>;

export async function toolStep(step: ToolStep, context: StepContext): Promise<StepExecution> {
  const input = await resolveInput(context, step.input);
  const value = await runAction(step.action, input, step.id, context);
  const record = step.action === MEMORY_LOOKUP ? lookupRecord(value) : value;
  return { next: "continue", output: value, record };
}
