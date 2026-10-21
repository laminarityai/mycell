// The fields a branch's condition may test (ADR-0015), with the catalog's declarations added to
// what the spec declares itself: its trigger's facts and its extract steps' fields. `spec`
// checks those; a tool step's fields are checked here, since only the catalog knows them.
// Pure: no IO, no ctx, so client code may import it.
import {
  EXTRACTED,
  operatorsFor,
  subjectParts,
  subjectWords,
  valueCheckIssues,
  type DeclaredFields,
  type Operator,
  type SubjectWords,
  type ValueCheck,
} from "@/features/spec/conditions";
import { eachStep, stepsAbove } from "@/features/spec/tree";
import { triggerFacts } from "@/features/spec/triggers";
import type { Spec, SpecIssue, Step, ValueType } from "@/features/spec/types";
import { findAction } from "./catalog";

/** A value a condition may test: `{ from }` as a check names it, its type, and its words. */
export type TestableField = { from: string; type: ValueType; label: string };

/** Every field the spec's trigger and the catalog's actions declare. */
export function declaredFields(spec: Spec): DeclaredFields {
  return {
    trigger: triggerFacts[spec.trigger.type],
    action: (name) => findAction(name)?.conditionFields,
  };
}

/**
 * What each of the spec's checks tests, in the words the condition editor labels it with: a
 * trigger fact's label, an extract field's description, a catalog action field's label.
 */
export function checkWords(spec: Spec): SubjectWords {
  return subjectWords(spec, (name) => findAction(name)?.conditionFields);
}

/**
 * Every value a check on one of `branchId`'s paths may test, for the condition editor: the
 * trigger's facts, then each extract and tool step's fields above the branch on its own path,
 * top down. Classify answers are checked by their own kind of check, so they aren't listed.
 * Empty when `branchId` isn't a branch.
 */
export function testableFields(spec: Spec, branchId: string): TestableField[] {
  const placed = eachStep(spec).find(({ step }) => step.id === branchId);
  if (placed?.step.type !== "branch") return [];
  const facts = triggerFacts[spec.trigger.type].map((fact) => ({
    from: `trigger.${fact.name}`,
    type: fact.type,
    label: fact.label,
  }));
  const fields = placed.above.flatMap((step): TestableField[] => {
    if (step.type === "extract") {
      return Object.entries(step.fields).map(([name, field]) => ({
        from: `${step.id}.${name}`,
        type: EXTRACTED[field.type],
        label: field.description,
      }));
    }
    if (step.type !== "tool") return [];
    return (findAction(step.action)?.conditionFields ?? []).map((field) => ({
      from: `${step.id}.${field.name}`,
      type: field.type,
      label: field.label,
    }));
  });
  return [...facts, ...fields];
}

/** A classify answer a check may test: the classify step, one of its labels, and the words. */
export type AnswerChoice = { classify: string; is: string; label: string };

/** What a check on one of a branch's paths may test, as the condition editor offers it. */
export type CheckChoices = {
  /** Each classify step's answers above the branch on its own path, top down. */
  answers: AnswerChoice[];
  /** Each value it may test (`testableFields`), with the operators its type allows. */
  fields: (TestableField & { operators: readonly Operator[] })[];
};

/** Everything a check on one of `branchId`'s paths may test, and how. */
export function checkChoices(spec: Spec, branchId: string): CheckChoices {
  const answers = stepsAbove(spec, branchId).flatMap((step) =>
    step.type === "classify"
      ? step.labels.map((is) => ({ classify: step.id, is, label: `"${step.id}" says "${is}"` }))
      : [],
  );
  const fields = testableFields(spec, branchId).map((field) => ({
    ...field,
    operators: operatorsFor(field.type),
  }));
  return { answers, fields };
}

/**
 * Each check on a tool step's result that names a field its action doesn't declare, or uses an
 * operator the field's type doesn't allow. Assumes the spec passed `validateSpec`, which
 * checked every other check.
 */
export function conditionIssues(spec: Spec): SpecIssue[] {
  const declared = declaredFields(spec);
  return eachStep(spec).flatMap(({ step, location, above }) => {
    if (step.type !== "branch") return [];
    return step.paths.flatMap((path, p) =>
      path.condition.checks.flatMap((check, c) => {
        if ("classify" in check || !onToolStep(check, above)) return [];
        const checkAt = (...field: string[]) => [
          ...location,
          ...["paths", p, "condition", "checks", c],
          ...field,
        ];
        return valueCheckIssues(check, checkAt, above, declared);
      }),
    );
  });
}

function onToolStep(check: ValueCheck, above: readonly Step[]) {
  const { source } = subjectParts(check.subject.from);
  return above.findLast((step) => step.id === source)?.type === "tool";
}
