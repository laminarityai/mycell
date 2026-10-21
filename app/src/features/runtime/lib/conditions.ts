// Evaluating a branch's conditions on the outputs above it (ADR-0015). Each check's result
// carries a reason, which may quote the value it tested (an extracted value, from the email):
// Try it shows it to the admin, and nothing records or stores it (invariant 8).
import { z } from "zod";
import { subjectParts, type ValueCheck } from "@/features/spec/conditions";
import type { BranchStep, Check } from "@/features/spec/types";
import type { BranchPath, CheckResult, Json } from "../types";
import { RunStepError } from "./failures";

type Outputs = Readonly<Record<string, Json>>;

/** Which paths a branch takes, and how each path's condition went. */
export type BranchChoice = { taken: string[]; paths: BranchPath[] };

/**
 * First match: checks the paths left to right until one's condition holds, and takes it, or
 * the otherwise path when none does. Paths after the one taken aren't checked.
 */
export function chooseFirstMatch(branch: BranchStep, outputs: Outputs): BranchChoice {
  const paths: BranchPath[] = [];
  let taken: string | undefined;
  for (const path of branch.paths) {
    if (taken !== undefined) {
      paths.push({ id: path.id, status: "not_checked", checks: [] });
      continue;
    }
    const checks = path.condition.checks.map((check) => checkResult(check, outputs));
    const passed = checks.map((check) => check.passed);
    const holds = path.condition.combine === "all" ? passed.every(Boolean) : passed.some(Boolean);
    if (holds) taken = path.id;
    paths.push({ id: path.id, status: holds ? "taken" : "not_taken", checks });
  }
  const otherwise = branch.otherwise.id;
  paths.push({ id: otherwise, status: taken === undefined ? "taken" : "not_needed", checks: [] });
  return { taken: [taken ?? otherwise], paths };
}

/** Whether the check passes on the outputs above its branch, and why. */
function checkResult(check: Check, outputs: Outputs): CheckResult {
  if ("classify" in check) {
    const answer = classification(outputs[check.classify]);
    if (answer === undefined) {
      throw new RunStepError("bad_reference", `The step ${check.classify} has no classification.`);
    }
    const passed = answer.label === check.is && answer.p >= check.minP;
    const sure = `${String(Math.round(answer.p * 100))}% sure`;
    return { passed, reason: `said ${JSON.stringify(answer.label)}, ${sure}` };
  }
  return valueResult(check, subjectValue(check.subject.from, outputs));
}

function valueResult(check: ValueCheck, value: Json | undefined): CheckResult {
  const missing =
    value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  if (check.op === "is_empty" || check.op === "is_not_empty") {
    return { passed: missing === (check.op === "is_empty"), reason: shown(value) };
  }
  if (missing) return { passed: false, reason: "had no value" };
  return { passed: holds(check, value), reason: shown(value) };
}

/** Text ignores case and surrounding spaces; a value of the wrong type fails the check. */
function holds(check: ValueCheck, value: Json): boolean {
  switch (check.op) {
    case "is_yes":
    case "is_no":
      return value === (check.op === "is_yes");
    case "equals":
      return value === check.value;
    case "does_not_equal":
      return typeof value === "number" && value !== check.value;
    case "more_than":
      return typeof value === "number" && value > check.value;
    case "less_than":
      return typeof value === "number" && value < check.value;
    case "at_least":
      return typeof value === "number" && value >= check.value;
    case "at_most":
      return typeof value === "number" && value <= check.value;
    case "is_empty":
    case "is_not_empty":
      return false;
  }
  if (typeof value !== "string") return false;
  const text = normal(value);
  const wanted = normal(check.value);
  switch (check.op) {
    case "is":
      return text === wanted;
    case "is_not":
      return text !== wanted;
    case "contains":
      return text.includes(wanted);
    case "does_not_contain":
      return !text.includes(wanted);
    case "starts_with":
      return text.startsWith(wanted);
    case "ends_with":
      return text.endsWith(wanted);
  }
}

const normal = (text: string) => text.trim().toLocaleLowerCase("en");

/** The value a check's subject names: an output's field above the branch. */
function subjectValue(from: string, outputs: Outputs): Json | undefined {
  const { source, field } = subjectParts(from);
  const output = outputs[source];
  // No output at all (a step that didn't run) is refused by typeof too.
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    throw new RunStepError("bad_reference", `The reference ${from} has no value.`);
  }
  return output[field];
}

function shown(value: Json | undefined): string {
  if (value === undefined || value === null) return "had no value";
  if (typeof value === "boolean") return value ? "was yes" : "was no";
  return `was ${JSON.stringify(value)}`;
}

function classification(output: Json | undefined): { label: string; p: number } | undefined {
  const parsed = z.object({ label: z.string(), p: z.number() }).safeParse(output);
  return parsed.success ? parsed.data : undefined;
}
