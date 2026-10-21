// What a path's condition may test, and with which checks (ADR-0015): a classify answer, or a
// value typed by what declares it: a fact the trigger declares, an extract step's field, or a
// field a catalog action declares on its result, from above the branch on its own path.
// Pure, so client code may import it.
import { eachStep } from "./tree";
import { triggerFacts } from "./triggers";
import {
  checkOperators,
  type Check,
  type ConditionField,
  type Spec,
  type SpecIssue,
  type Step,
  type ValueType,
} from "./types";

export type { ValueType };

/** A check that tests a value rather than a classify answer. */
export type ValueCheck = Exclude<Check, { classify: string }>;
export type Operator = ValueCheck["op"];

/** The operators a value of this type may be checked with: its own, then the empty checks. */
export function operatorsFor(type: ValueType): readonly Operator[] {
  return [...checkOperators[type], ...checkOperators.any];
}

/** A new check on a field: its type's first operator, and a blank value of its type. */
export function checkOn(field: { from: string; type: ValueType }): ValueCheck {
  const [first] = checkOperators[field.type];
  return withOperator({ subject: { from: field.from }, op: "is_empty" }, first);
}

/**
 * The check with another operator: a value it had is kept when the operator takes one of its
 * type, a blank of the right type is given when it had none, and none is kept for an operator
 * that takes no value.
 */
export function withOperator(check: ValueCheck, op: Operator): ValueCheck {
  const value = "value" in check ? check.value : undefined;
  const { subject } = check;
  if (isOneOf(checkOperators.text, op)) {
    return { subject, op, value: typeof value === "string" ? value : "" };
  }
  if (isOneOf(checkOperators.number, op)) {
    return { subject, op, value: typeof value === "number" ? value : 0 };
  }
  return { subject, op };
}

function isOneOf<Op extends Operator>(ops: readonly Op[], op: Operator): op is Op {
  return (ops as readonly Operator[]).includes(op);
}

/** An operator in words: "is more than", "doesn't contain". */
export function operatorWords(op: Operator): string {
  return OPERATOR_WORDS[op];
}

const OPERATOR_WORDS: Record<Operator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  equals: "equals",
  does_not_equal: "doesn't equal",
  more_than: "is more than",
  less_than: "is less than",
  at_least: "is at least",
  at_most: "is at most",
  is_yes: "is yes",
  is_no: "is no",
  is_empty: "is empty",
  is_not_empty: "isn't empty",
};

/** What a check's subject names, in words: `{ from }` as a check names it, to its label. */
export type SubjectWords = (from: string) => string;

/**
 * A check in words, from the spec's own literals and the labels of what it tests only:
 * `"kind" says "pricing" with at least 85% confidence`, `the order total is more than 1000`.
 * Never a value a run tested, so it may go anywhere the spec may, the builder's conversation
 * included. `words` names the subject (`subjectWords`); without it, by its field's name.
 */
export function describeCheck(check: Check, words: SubjectWords = readableSubject): string {
  if ("classify" in check) {
    const percent = String(Math.round(check.minP * 100));
    return `"${check.classify}" says "${check.is}" with at least ${percent}% confidence`;
  }
  const phrase = `${inSentence(words(check.subject.from))} ${OPERATOR_WORDS[check.op]}`;
  return "value" in check ? `${phrase} ${JSON.stringify(check.value)}` : phrase;
}

/**
 * Each subject of the spec's checks in words, as the condition editor labels it: a trigger
 * fact by the label its trigger declares, an extract step's field by its description, and a
 * tool step's field by the label its catalog action declares. `spec` doesn't know the catalog,
 * so `action` gives each action's fields; a field nothing labels is named by its own name.
 */
export function subjectWords(spec: Spec, action?: DeclaredFields["action"]): SubjectWords {
  const steps = new Map(eachStep(spec).map(({ step }) => [step.id, step]));
  const labelOf = (source: string, field: string): string | undefined => {
    if (source === "trigger") return labelIn(triggerFacts[spec.trigger.type], field);
    const step = steps.get(source);
    if (step?.type === "extract") {
      return Object.hasOwn(step.fields, field) ? step.fields[field].description : undefined;
    }
    return step?.type === "tool" ? labelIn(action?.(step.action) ?? [], field) : undefined;
  };
  return (from) => {
    const { source, field } = subjectParts(from);
    const label = labelOf(source, field)?.trim();
    return label === undefined || label === "" ? readableSubject(from) : label;
  };
}

function labelIn(fields: readonly ConditionField[], name: string): string | undefined {
  return fields.find((candidate) => candidate.name === name)?.label;
}

/** A subject by its field's own name, in words: `details.orderTotal` is "order total". */
function readableSubject(from: string): string {
  return subjectParts(from)
    .field.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_.]+/g, " ")
    .toLocaleLowerCase("en");
}

/** A label that starts a sentence, made to read inside one; an acronym ("PO number") is kept. */
function inSentence(label: string): string {
  const [first = "", second = ""] = label;
  return second === second.toLocaleUpperCase("en") && second !== " "
    ? label
    : first.toLocaleLowerCase("en") + label.slice(1);
}

/** The type a check gives an extract step's field, by the type the step declares it with. */
export const EXTRACTED: Record<"string" | "number" | "boolean", ValueType> = {
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
 * The fields declared outside the spec's steps: the facts its trigger declares, and each
 * catalog action's result fields. `spec` doesn't know the catalog, so its own validation leaves
 * `action` out, and the policy engine, which does, checks a tool step's fields.
 */
export type DeclaredFields = {
  trigger: readonly ConditionField[];
  action?: (name: string) => readonly ConditionField[] | undefined;
};

/**
 * The type of the value `from` names, given the steps above the branch on its own path, or why
 * a check can't test it. The type is undefined for a tool step's field when `declared` has no
 * `action`: only the catalog knows it.
 */
export function subjectType(
  from: string,
  above: readonly Step[],
  declared: DeclaredFields,
): { ok: true; type: ValueType | undefined } | { ok: false; message: string } {
  const { source, field } = subjectParts(from);
  if (source === "trigger") {
    return fieldIn(declared.trigger, field, `The trigger has no fact "${field}"`);
  }
  const step = above.findLast((candidate) => candidate.id === source);
  if (step === undefined) {
    return { ok: false, message: `"${source}" isn't above this branch on its path.` };
  }
  if (step.type === "tool") {
    if (declared.action === undefined) return { ok: true, type: undefined };
    const fields = declared.action(step.action) ?? [];
    return fieldIn(fields, field, `"${source}" (${step.action}) gives no field "${field}" to test`);
  }
  if (step.type !== "extract") {
    return {
      ok: false,
      message: `A check can test the trigger's facts or an extract or tool step's fields, and "${source}" is a ${step.type} step.`,
    };
  }
  const extracted = Object.hasOwn(step.fields, field) ? step.fields[field] : undefined;
  if (extracted === undefined) {
    return { ok: false, message: `"${source}" has no field "${field}".` };
  }
  return { ok: true, type: EXTRACTED[extracted.type] };
}

function fieldIn(fields: readonly ConditionField[], name: string, missing: string) {
  const found = fields.find((candidate) => candidate.name === name);
  if (found !== undefined) return { ok: true as const, type: found.type };
  const named = fields.map((candidate) => candidate.name).join(", ");
  const message = `${missing}; it may test ${named === "" ? "none" : named}.`;
  return { ok: false as const, message };
}

/**
 * Why a check on a value can't run: its subject isn't something above the branch it may test,
 * or its operator doesn't fit the subject's type. `checkAt` places each issue.
 */
export function valueCheckIssues(
  check: ValueCheck,
  checkAt: (...field: string[]) => SpecIssue["path"],
  above: readonly Step[],
  declared: DeclaredFields,
): SpecIssue[] {
  const subject = subjectType(check.subject.from, above, declared);
  if (!subject.ok) return [{ path: checkAt("subject", "from"), message: subject.message }];
  if (subject.type !== undefined && !operatorsFor(subject.type).includes(check.op)) {
    const message = `${check.subject.from} is ${TYPE_WORDS[subject.type]}, so "${check.op}" can't check it.`;
    return [{ path: checkAt("op"), message }];
  }
  return [];
}

const TYPE_WORDS: Record<ValueType, string> = {
  text: "text",
  number: "a number",
  yesNo: "a yes or no",
};
