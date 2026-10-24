// A working spec as the workflow editor holds it: any JSON object with a list of step objects,
// which needn't be a valid spec yet (validation says what's wrong, at the step and field it's
// about). Pure, so client code may import it.
import { specSettings, type Spec, type SpecIssue } from "./types";
import { validateSpec } from "./validate";
import { isRecord } from "@/lib/utils";

/** One step as the editor holds it: whatever fields it has, not yet validated. */
export type StepDraft = { id?: unknown; type?: unknown; [field: string]: unknown };

/** A spec as the editor holds it. */
export type SpecDraft = { steps: StepDraft[]; [field: string]: unknown };

export type SpecJsonRead = { ok: true; draft: SpecDraft } | { ok: false; message: string };

/**
 * The JSON view's text as a draft, or why it can't be one: it isn't JSON, or isn't an object
 * whose `steps` is a list of objects. A spec with no `steps` yet gets an empty list.
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
  if (!isRecord(value)) return { ok: false, message: "The spec must be a JSON object." };
  const steps = value.steps ?? [];
  if (!Array.isArray(steps) || !steps.every(isRecord)) {
    return { ok: false, message: "The spec's steps must be a list of objects." };
  }
  return { ok: true, draft: { ...value, steps } };
}

/**
 * The draft's steps as a spec the graph can draw and edit, whatever its settings say (a new
 * workflow has no spec ID yet): its steps validated as they stand, upgraded if they're v1's,
 * under stand-in settings. Only its steps and its trigger (when it's a valid one, since what a
 * step may read comes from it) are the draft's. Null when the steps don't validate.
 */
export function readDraftTree(draft: SpecDraft): Spec | null {
  const trigger = specSettings.trigger.safeParse(draft.trigger);
  const settings = {
    id: "draft",
    credentials: "member",
    trigger: trigger.success
      ? trigger.data
      : { type: "gmail.message_received", labelIds: ["INBOX"] },
    autonomy: { rung: 3 },
  } satisfies Omit<Spec, "specVersion" | "steps">;
  if (draft.steps.length === 0) return { ...settings, specVersion: 2, steps: [] };
  const version = draft.specVersion === 1 ? 1 : 2;
  const checked = validateSpec({ ...settings, specVersion: version, steps: draft.steps });
  return checked.ok ? checked.spec : null;
}

/**
 * Issues grouped by what they're about, so each shows on its box or path: an issue inside a
 * step or path goes under the ID of the innermost one holding it; the rest, about the spec's
 * settings or its list of steps as a whole, under `spec`.
 */
export function issuesByTarget(
  draft: SpecDraft,
  issues: readonly SpecIssue[],
): { spec: SpecIssue[]; byId: Map<string, SpecIssue[]> } {
  const spec: SpecIssue[] = [];
  const byId = new Map<string, SpecIssue[]>();
  for (const issue of issues) {
    const id = targetOf(draft, issue.path);
    if (id === null) spec.push(issue);
    else byId.set(id, [...(byId.get(id) ?? []), issue]);
  }
  return { spec, byId };
}

/** The ID of the innermost step or path `path` leads into, following it through the draft. */
function targetOf(draft: SpecDraft, path: SpecIssue["path"]): string | null {
  let at: unknown = draft;
  let target: string | null = null;
  path.forEach((key, i) => {
    at = isRecord(at) || Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
    // A step or path is an object in a `steps` or `paths` list, or a branch's `otherwise`.
    const parent = path[i - 1];
    const holder = key === "otherwise" || parent === "steps" || parent === "paths";
    if (holder && isRecord(at) && typeof at.id === "string") target = at.id;
  });
  return target;
}
