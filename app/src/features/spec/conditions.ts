// What a path's condition may test, and with which checks (ADR-0015): a classify answer, or a
// value read from above the branch on its own path, typed by what declares it. Today that's an
// extract step's fields; facts about the trigger and catalog actions' result fields come later.
// Pure, so client code may import it.
import { checkOperators, type Check, type Step } from "./types";

/** The type of a value a check tests, which decides the operators it may use. */
export type ValueType = "text" | "number" | "yesNo";

/** A check that tests a value rather than a classify answer. */
export type ValueCheck = Exclude<Check, { classify: string }>;
export type Operator = ValueCheck["op"];

/** The operators a value of this type may be checked with: its own, then the empty checks. */
export function operatorsFor(type: ValueType): readonly Operator[] {
  return [...checkOperators[type], ...checkOperators.any];
}

const OPERATOR_WORDS: Record<Operator, string> = {
  is: "is",
  is_not: "isn't",
  contains: "contains",
  does_not_contain: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  equals: "is",
  does_not_equal: "isn't",
  more_than: "is more than",
  less_than: "is less than",
  at_least: "is at least",
  at_most: "is at most",
  is_yes: "is yes",
  is_no: "is no",
  is_empty: "is empty",
  is_not_empty: "isn't empty",
};

/**
 * A check in words, from the spec's own literals only: `kind is "pricing", at least 85% sure`,
 * `details.total is more than 1000`. Never a value a run tested, so it may go anywhere the spec
 * may, the builder's conversation included.
 */
export function describeCheck(check: Check): string {
  if ("classify" in check) {
    const sure = `${String(Math.round(check.minP * 100))}% sure`;
    return `${check.classify} is ${JSON.stringify(check.is)}, at least ${sure}`;
  }
  const words = `${check.subject.from} ${OPERATOR_WORDS[check.op]}`;
  return "value" in check ? `${words} ${JSON.stringify(check.value)}` : words;
}

const DECLARED: Record<"string" | "number" | "boolean", ValueType> = {
  string: "text",
  number: "number",
  boolean: "yesNo",
};

/** Where a subject's value comes from, as a check names it: `<step>.<field>`. */
export function subjectParts(from: string): { source: string; field: string } {
  const [source = "", ...field] = from.split(".");
  return { source, field: field.join(".") };
}

/**
 * The type of the value `from` names, given the steps above the branch on its own path, or why
 * a check can't test it. The step must be above the branch, which the caller checks first.
 */
export function subjectType(
  from: string,
  above: readonly Step[],
): { ok: true; type: ValueType } | { ok: false; message: string } {
  const { source, field } = subjectParts(from);
  if (source === "trigger") {
    return { ok: false, message: "Facts about the message can't be checked yet." };
  }
  const step = above.findLast((candidate) => candidate.id === source);
  if (step === undefined) {
    return { ok: false, message: `"${source}" isn't above this branch on its path.` };
  }
  if (step.type !== "extract") {
    return {
      ok: false,
      message: `A check can test an extract step's fields, and "${source}" is a ${step.type} step.`,
    };
  }
  const declared = Object.hasOwn(step.fields, field) ? step.fields[field] : undefined;
  if (declared === undefined) {
    return { ok: false, message: `"${source}" has no field "${field}".` };
  }
  return { ok: true, type: DECLARED[declared.type] };
}
