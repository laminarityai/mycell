// A tool step: resolve its input's references, then run its action, which checks the input and
// the output against the action's schemas. The whole result passes to later steps, content
// included; the run record lists only its fields' kinds and sizes (ADR-0021), so a memory
// lookup's record keeps how many facts it found, never the facts, which are its member's
// (ADR-0001).
import type { Step } from "@/features/spec/types";
import type { Json, ResultField } from "../types";
import { resolveInput } from "./references";
import { runAction } from "./run-action";
import type { StepContext, StepExecution } from "./step-context";

type ToolStep = Extract<Step, { type: "tool" }>;

export async function toolStep(step: ToolStep, context: StepContext): Promise<StepExecution> {
  const input = await resolveInput(context, step.input);
  const value = await runAction(step.action, input, step.id, context);
  return { next: "continue", output: value, record: { fields: resultFields(value) } };
}

/**
 * Each of the result's fields by its kind and size, never its value. An action's result is an
 * object; anything else is listed as one field, `result`.
 */
function resultFields(value: Json): Record<string, ResultField> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { result: fieldOf(value) };
  }
  return Object.fromEntries(Object.entries(value).map(([name, field]) => [name, fieldOf(field)]));
}

function fieldOf(value: Json): ResultField {
  if (value === null) return { kind: "empty" };
  if (typeof value === "string") return { kind: "text", size: value.length };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "boolean") return { kind: "yes_no" };
  if (Array.isArray(value)) return { kind: "list", size: value.length };
  return { kind: "record", size: Object.keys(value).length };
}
