// Running one catalog action for a step, as the tool and draft steps both do: find the action
// and its executor, check the input against the catalog's schema, run it, and check what it
// returned. Messages name the action and the fields, never their values.
import { findAction, type ActionName } from "@/features/policy/catalog";
import type { Json } from "../types";
import { actionExecutors } from "./actions";
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
  const action = findAction(name);
  // findAction found it, so it's a catalog action's name.
  const executor = action === undefined ? undefined : actionExecutors[action.name as ActionName];
  if (action === undefined || executor === undefined || executor.status === "pending") {
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
  const marker = `${context.run.id}/${stepId}`;
  // The input passed the action's own schema, which its executor's input type matches.
  const valid = parsed.data as never;
  const result = await executor.run(context.ctx, context.run.connectionId, valid, marker, compose);
  const output = action.output.safeParse(result);
  if (!output.success) {
    throw new RunStepError("invalid_output", `${name} returned an unexpected result.`);
  }
  return output.data as Json;
}
