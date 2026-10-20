// A step's checks (docs/architecture.md, "Workflow spec"): what its output must look like before
// later steps may use it. A failed check fails the step without a retry, since trying again
// would only ask the same question again. Messages name the check, field paths and value types,
// never the values themselves (invariant 8).
import type { Step } from "@/features/spec/types";
import { ModelCallError, type Json } from "../types";
import { schemaProblems } from "./json-schema";
import type { StepExecution } from "./step-context";

export const stepChecks = ["schema", "minP", "requiredFields"] as const;
export type StepCheck = (typeof stepChecks)[number];

/** A step's output failed one of its checks. The message holds no content. */
export class StepCheckError extends Error {
  readonly check: StepCheck;

  constructor(check: StepCheck, message: string) {
    super(message);
    this.name = "StepCheckError";
    this.check = check;
  }
}

/**
 * Runs the step's work, then its checks on the output it hands on. A model answer that didn't
 * fit the step's own schema fails the `schema` check when the step has one; otherwise it stays a
 * model error, which is retried.
 */
export async function checked(
  step: Step,
  work: () => Promise<StepExecution>,
): Promise<StepExecution> {
  let execution: StepExecution;
  try {
    execution = await work();
  } catch (error) {
    if (error instanceof ModelCallError && error.code === "off_schema" && step.checks?.schema) {
      throw new StepCheckError(
        "schema",
        `The schema check failed: the ${error.role} model's answer didn't fit the step.`,
      );
    }
    throw error;
  }
  checkOutput(step, execution.output);
  return execution;
}

function checkOutput(step: Step, output: Json): void {
  const checks = step.checks;
  if (checks === undefined) return;
  if (checks.schema !== undefined) {
    const problems = schemaProblems(checks.schema, output);
    if (problems.length > 0) {
      throw new StepCheckError("schema", `The schema check failed: ${problems.join("; ")}.`);
    }
  }
  if (checks.minP !== undefined) checkMinP(checks.minP, output);
  if (checks.requiredFields !== undefined) checkRequiredFields(checks.requiredFields, output);
}

function checkMinP(minP: number, output: Json): void {
  const p = fieldOf(output, "p");
  if (typeof p !== "number") {
    throw new StepCheckError("minP", "The minP check failed: the output has no number p.");
  }
  if (p < minP) {
    throw new StepCheckError("minP", `The minP check failed: p is below ${String(minP)}.`);
  }
}

/** An extract's field counts as filled when it holds a value other than null or "". */
function checkRequiredFields(names: string[], output: Json): void {
  const unfilled = names.filter((name) => {
    const value = fieldOf(output, name);
    return value === undefined || value === null || value === "";
  });
  if (unfilled.length > 0) {
    throw new StepCheckError(
      "requiredFields",
      `The requiredFields check failed: ${unfilled.join(", ")} not filled.`,
    );
  }
}

function fieldOf(output: Json, name: string): Json | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return undefined;
  return output[name];
}
