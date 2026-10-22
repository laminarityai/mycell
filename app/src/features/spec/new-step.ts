// What "+" on the graph adds: a new step of a kind, or a new path for a branch, each with an ID
// no step or path has and blanks that validate, so the graph keeps drawing the workflow while
// the admin fills them in. Pure, so client code may import it.
import type { InsertAt } from "./edit";
import { eachStep, findStep, stepsAbove } from "./tree";
import { triggers } from "./triggers";
import type { Check, Path, Spec, Step } from "./types";

/**
 * A kind of step to add. `spec` doesn't know the catalog, so a tool step's caller names its
 * action's inputs.
 */
export type NewStepKind =
  | { type: "classify" | "extract" | "draft" | "escalate" | "branch" }
  | { type: "tool"; action: string; inputs: readonly string[] };

/** A new step of `kind`, to insert at `at`. A branch's first path tests what's above `at`. */
export function newStep(spec: Spec, at: InsertAt, kind: NewStepKind): Step {
  const ids = takenIds(spec);
  const trigger = triggers[spec.trigger.type];
  switch (kind.type) {
    case "classify":
      return {
        id: freshId(ids, "classify"),
        type: "classify",
        role: "classify",
        question: "What kind of message is this?",
        labels: ["yes", "no"],
      };
    case "extract":
      return {
        id: freshId(ids, "extract"),
        type: "extract",
        role: "fast",
        fields: { value: { type: "string", description: "A value from the message" } },
      };
    case "draft":
      return {
        id: freshId(ids, "draft"),
        type: "draft",
        role: "smart",
        instructions: "Write a short, friendly reply.",
        context: trigger.context.slice(0, 1),
        output: "google-mail.create-draft",
      };
    case "escalate":
      return { id: freshId(ids, "escalate"), type: "escalate", reason: "A person should look." };
    case "tool":
      return {
        id: freshId(ids, kind.action.split(".").at(-1) ?? "tool"),
        type: "tool",
        action: kind.action,
        input: Object.fromEntries(
          kind.inputs.map((name) => [name, blankInput(trigger.fields, name)]),
        ),
      };
    case "branch": {
      const id = freshId(ids, "branch");
      const path = blankPath(spec, ids, 1, aboveAt(spec, at));
      return {
        id,
        type: "branch",
        mode: "first",
        paths: [path],
        otherwise: { id: freshId(ids, "otherwise"), steps: [] },
      };
    }
  }
}

/** A new path for the branch, its condition testing what's above the branch. */
export function newPath(spec: Spec, branchId: string): Path {
  const branch = findStep(spec, branchId);
  const count = branch?.type === "branch" ? branch.paths.length : 0;
  return blankPath(spec, takenIds(spec), count + 1, stepsAbove(spec, branchId));
}

function blankPath(spec: Spec, ids: Set<string>, number: number, above: readonly Step[]): Path {
  return {
    id: freshId(ids, "path"),
    name: `Path ${String(number)}`,
    condition: { combine: "all", checks: [firstCheck(spec, above)] },
    steps: [],
  };
}

/**
 * The nearest classify step's first answer above, or else a text fact of the trigger's: the
 * message's subject, or the invite's organizer.
 */
function firstCheck(spec: Spec, above: readonly Step[]): Check {
  const classify = above.findLast((step) => step.type === "classify");
  if (classify?.type === "classify") {
    return { classify: classify.id, is: classify.labels[0] ?? "", minP: 0.8 };
  }
  return { subject: { from: `trigger.${firstTextFact(spec)}` }, op: "contains", value: "" };
}

/** The fact a new check on the trigger tests: the subject, or else its first text fact. */
export function firstTextFact(spec: Spec): string {
  const facts = triggers[spec.trigger.type].facts;
  const fact = facts.find((one) => one.name === "subject") ?? facts.find((f) => f.type === "text");
  return fact?.name ?? "subject";
}

/** The steps a step inserted at `at` would have above it on its own path. */
function aboveAt(spec: Spec, at: InsertAt): Step[] {
  if (at.after !== null) {
    const after = findStep(spec, at.after);
    return after === undefined ? [] : [...stepsAbove(spec, at.after), after];
  }
  if (at.list === "root") return [];
  for (const { step, above } of eachStep(spec)) {
    if (step.type !== "branch") continue;
    const lists = [...step.paths.map((path) => path.id), step.otherwise.id];
    if (lists.includes(at.list)) return [...above, step];
  }
  return [];
}

/** An input a run fills from the trigger when it names one of the trigger's fields. */
function blankInput(fields: readonly string[], name: string): string | { from: string } {
  return fields.includes(name) ? { from: `trigger.${name}` } : "";
}

/** Every step and path ID in the spec: they share one namespace. */
function takenIds(spec: Spec): Set<string> {
  const ids = new Set<string>();
  for (const { step } of eachStep(spec)) {
    ids.add(step.id);
    if (step.type !== "branch") continue;
    for (const path of step.paths) ids.add(path.id);
    ids.add(step.otherwise.id);
  }
  return ids;
}

/** `base`, or `base-2`, `base-3`… whichever is free first; it's then taken. */
function freshId(taken: Set<string>, base: string): string {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${String(n)}`;
  taken.add(id);
  return id;
}
