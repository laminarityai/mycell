// Running one action for a step, as the tool and draft steps both do: find the action in the
// company's action set and its executor (a catalog action's own, or the one generic executor for
// a custom action), check the input against the action's schema, run it, and check what it
// returned. Messages name the action and the fields, never their values.
import type { ActionName } from "@/features/policy/catalog";
import type { Json } from "@/lib/inngest";
import { runCustomAction, type CustomInput } from "./custom-action";
import { RunStepError } from "./failures";
import type { Compose, StepContext } from "./step-context";

/**
 * Runs the action `name` with `input` for the step `stepId`, and returns its checked output.
 * `compose` is a draft step's generator of the text, for the action that writes it.
 */
export async function runAction(
  name: string,
  input: unknown,
  stepId: string,
  context: StepContext,
  compose?: Compose,
): Promise<Json> {
  const action = context.actionSet.find(name);
  // Executors are by catalog action name; a name with none isn't available.
  const executor =
    action?.kind === "catalog" ? context.actions[action.name as ActionName] : undefined;
  if (action === undefined || executor?.status === "pending") {
    throw new RunStepError("not_available", `The action ${name} isn't available yet.`);
  }
  const parsed = action.input.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new RunStepError(
      "invalid_input",
      `The input to ${name} is invalid at: ${fields.join(", ")}.`,
    );
  }
  const { ctx, run } = context;
  let result: unknown;
  if (action.kind === "custom" && action.risk !== "read") {
    // A custom write is never sent by a step: it's held for its review (ADR-0020), and its
    // result fields never reach the run.
    const input = parsed.data as CustomInput;
    return context.holdSend(ctx, run, stepId, action, input);
  } else if (action.kind === "custom") {
    // A custom read runs for real in a run and in Try it alike.
    result = await runCustomAction(ctx, run.connectionId, action, parsed.data as never);
  } else if (executor === undefined) {
    throw new RunStepError("not_available", `The action ${name} isn't available yet.`);
  } else {
    const marker = `${run.id}/${stepId}`;
    // The input passed the action's own schema, which its executor's input type matches.
    const valid = parsed.data as never;
    const runOf = {
      id: run.id,
      sourceRef: run.sourceRef,
      workflowId: context.attribution.workflowId,
    };
    result = await executor.run(ctx, run.connectionId, valid, marker, compose, runOf);
  }
  const output = action.output.safeParse(result);
  if (!output.success) {
    throw new RunStepError("invalid_output", `${name} returned an unexpected result.`);
  }
  return output.data as Json;
}
