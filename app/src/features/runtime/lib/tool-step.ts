// A tool step: resolve its input's references, check the input against the catalog action's
// schema, run the action's executor, and check what it returned.
import { findAction, type ActionName } from "@/features/policy/catalog";
import type { Step } from "@/features/spec/types";
import type { Json } from "../types";
import { actionExecutors } from "./actions";
import { RunStepError } from "./failures";
import { resolveInput } from "./references";
import type { StepContext, StepExecution } from "./step-context";

type ToolStep = Extract<Step, { type: "tool" }>;

export async function toolStep(step: ToolStep, context: StepContext): Promise<StepExecution> {
  const action = findAction(step.action);
  // findAction found it, so it's a catalog action's name.
  const executor = action === undefined ? undefined : actionExecutors[action.name as ActionName];
  if (action === undefined || executor === undefined || executor.status === "pending") {
    throw new RunStepError("not_available", `The action ${step.action} isn't available yet.`);
  }
  const input = action.input.safeParse(await resolveInput(context, step.input));
  if (!input.success) {
    const fields = [...new Set(input.error.issues.map((issue) => issue.path.join(".")))];
    throw new RunStepError(
      "invalid_input",
      `The input to ${step.action} is invalid at: ${fields.join(", ")}.`,
    );
  }
  const result = await executor.run(context.ctx, context.run.connectionId, input.data as never);
  const output = action.output.safeParse(result);
  if (!output.success) {
    throw new RunStepError("invalid_output", `${step.action} returned an unexpected result.`);
  }
  const value = output.data as Json;
  return { next: "continue", output: value, record: value };
}
