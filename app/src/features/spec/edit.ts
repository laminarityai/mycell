// Editing a working spec by hand, as the workflow editor's form does. The form edits a draft:
// any JSON object with a list of step objects, which needn't be a valid spec yet (validation
// says what's wrong, at the step and field it's about). The form shows v1's one list of steps,
// where a branch goes on or stops: a v2 spec whose branches each have one path is shown that
// way, and saving upgrades it back. Pure, so client code may import it.
import { sameValue } from "./diff";
import type { SpecIssue, StepType } from "./types";
import { upgradeDraft } from "./upgrade";

/** One step as the form edits it: whatever fields it has, not yet validated. */
export type StepDraft = { id?: unknown; type?: unknown; [field: string]: unknown };

/** A spec as the form edits it. */
export type SpecDraft = { steps: StepDraft[]; [field: string]: unknown };

export type SpecJsonRead = { ok: true; draft: SpecDraft } | { ok: false; message: string };

/**
 * The JSON view's text as a draft the form can show, or why it can't: it isn't JSON, or isn't
 * an object whose `steps` is a list of objects, or is a v2 spec the form can't show as one
 * list. A spec with no `steps` yet gets an empty list.
 */
export function readSpecJson(text: string): SpecJsonRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: "This isn't valid JSON. Check for a missing comma, quote or bracket.",
    };
  }
  if (!isObject(value)) return { ok: false, message: "The spec must be a JSON object." };
  const steps = value.steps ?? [];
  if (!Array.isArray(steps) || !steps.every(isObject)) {
    return { ok: false, message: "The spec's steps must be a list of objects." };
  }
  const draft = { ...value, steps };
  if (value.specVersion !== 2) return { ok: true, draft };
  const flat = oneList(draft);
  if (flat === undefined) {
    return {
      ok: false,
      message:
        "The form shows a workflow whose branches each have one path, and stop or hand the message to a person otherwise. Edit this one in the JSON view.",
    };
  }
  return { ok: true, draft: flat };
}

/** A v2 draft as v1's one list of steps, when upgrading that list gives the draft back. */
function oneList(draft: SpecDraft): SpecDraft | undefined {
  const steps = gatesOf(draft.steps);
  if (steps === undefined) return undefined;
  const flat = { ...draft, specVersion: 1, steps };
  return sameValue(upgradeDraft(flat), draft) ? flat : undefined;
}

/** Each branch as a v1 gate followed by its one path's steps; undefined for one v1 can't show. */
function gatesOf(steps: StepDraft[]): StepDraft[] | undefined {
  const flat: StepDraft[] = [];
  for (const step of steps) {
    if (step.type !== "branch" || !("paths" in step)) {
      flat.push(step);
      continue;
    }
    const own = Object.fromEntries(
      Object.entries(step).filter(([field]) => !["mode", "paths", "otherwise"].includes(field)),
    );
    const path = listOf(step.paths).at(0);
    const check =
      isObject(path) && isObject(path.condition) ? listOf(path.condition.checks).at(0) : undefined;
    const after = isObject(path) ? listOf(path.steps).filter(isObject) : [];
    const handsOver = isObject(step.otherwise) && listOf(step.otherwise.steps).length > 0;
    const rest = gatesOf(after);
    if (!isObject(check) || rest === undefined) return undefined;
    const when = { step: check.classify, label: check.is, minP: check.minP };
    flat.push({ ...own, when, else: handsOver ? "escalate" : "stop" }, ...rest);
  }
  return flat;
}

/**
 * The draft with step `index`'s fields changed: each key of `fields` is set, or removed when
 * its value is undefined. The draft itself is left as it was.
 */
export function updateStep(
  draft: SpecDraft,
  index: number,
  fields: Record<string, unknown>,
): SpecDraft {
  return {
    ...draft,
    steps: draft.steps.map((step, at) => (at === index ? withFields(step, fields) : step)),
  };
}

/** The draft with a new step of `type` at the end, its blanks for the admin to fill in. */
export function addStep(draft: SpecDraft, type: StepType): SpecDraft {
  const taken = new Set(draft.steps.map((step) => step.id));
  let id: string = type;
  for (let n = 2; taken.has(id); n += 1) id = `${type}-${String(n)}`;
  return { ...draft, steps: [...draft.steps, { id, type, ...blankFields(type, draft) }] };
}

export function removeStep(draft: SpecDraft, index: number): SpecDraft {
  return { ...draft, steps: draft.steps.filter((_, at) => at !== index) };
}

/** The draft with step `index` moved one place up (-1) or down (1); unchanged at either end. */
export function moveStep(draft: SpecDraft, index: number, by: -1 | 1): SpecDraft {
  const to = index + by;
  const step = draft.steps.at(index);
  const other = draft.steps.at(to);
  if (index < 0 || to < 0) return draft;
  if (step === undefined || other === undefined) return draft;
  const steps = [...draft.steps];
  steps[to] = step;
  steps[index] = other;
  return { ...draft, steps };
}

/**
 * Issues grouped for the form: those about step `i` (path `steps.i…`) under `steps.get(i)`,
 * with paths relative to the step; the rest, about the spec's settings, under `spec`.
 */
export function issuesByStep(issues: readonly SpecIssue[]): {
  spec: SpecIssue[];
  steps: Map<number, SpecIssue[]>;
} {
  const spec: SpecIssue[] = [];
  const steps = new Map<number, SpecIssue[]>();
  for (const issue of issues) {
    const [first, index, ...rest] = issue.path;
    if (first !== "steps" || typeof index !== "number") {
      spec.push(issue);
      continue;
    }
    steps.set(index, [...(steps.get(index) ?? []), { path: rest, message: issue.message }]);
  }
  return { spec, steps };
}

function blankFields(type: StepType, draft: SpecDraft): Record<string, unknown> {
  switch (type) {
    case "classify":
      return { role: "classify", question: "", labels: ["yes", "no"] };
    case "branch": {
      const classify = draft.steps.findLast((step) => step.type === "classify");
      return {
        when: {
          step: typeof classify?.id === "string" ? classify.id : "",
          label: "yes",
          minP: 0.8,
        },
        else: "stop",
      };
    }
    case "extract":
      return { role: "fast", fields: { field: { type: "string", description: "" } } };
    case "tool":
      return { action: "", input: {} };
    case "draft":
      return {
        role: "smart",
        instructions: "",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      };
    case "approval":
      return { channel: "gmail_drafts" };
    case "escalate":
      return { reason: "" };
  }
}

function withFields(step: StepDraft, fields: Record<string, unknown>): StepDraft {
  const entries = Object.entries({ ...step, ...fields });
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
