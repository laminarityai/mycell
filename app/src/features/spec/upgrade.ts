// Reading a spec from before branches had paths as the current version (ADR-0015). A v1 gate
// let the run go on or ended it; it becomes a first-match branch with one path, its check,
// holding every step after the gate, and an otherwise path that stops the run or hands the
// message to a person as the gate did. Every v1 step ID is kept, the gate's included, so
// recorded runs and runs memoized part-way still match their steps. Pure, so client code may
// import it.
import type { Spec, SpecIssue } from "./types";
import type { SpecV1 } from "./v1";
import { isRecord } from "@/lib/utils";

/** The reason on the escalate step a gate that escalated becomes: fixed words, as v1 had none. */
export const ESCALATE_REASON = "The message didn't meet the branch's condition.";

/** The spec in the current version's shape. Pure and idempotent: a v2 spec passes through. */
export function upgradeSpec(spec: SpecV1 | Spec): Spec {
  if (spec.specVersion === 2) return spec;
  // A valid v1 spec makes a valid v2 one, step for step (the upgrade tests hold each fixture
  // to that), so the structural rewrite is read back as the v2 type.
  const upgraded: object = upgradeDraft(spec);
  return upgraded as Spec;
}

/**
 * Any spec-like object with v1's version upgraded the same way, valid or not: for the form,
 * which edits a v1-shaped draft. Anything else comes back as it was.
 */
export function upgradeDraft<Draft extends object>(draft: Draft): Draft {
  const { specVersion, steps } = draft as { specVersion?: unknown; steps?: unknown };
  if (specVersion !== 1 || !Array.isArray(steps)) return draft;
  const list = steps.filter(isRecord);
  const taken = new Set(list.map((step) => step.id).filter((id) => typeof id === "string"));
  return { ...draft, specVersion: 2, steps: upgradeSteps(list, taken) };
}

function upgradeSteps(steps: StepLike[], taken: Set<string>): StepLike[] {
  const at = steps.findIndex(isGate);
  if (at === -1) return steps;
  const gate = steps[at];
  const { when, else: otherwise, ...own } = gate;
  const { step, label, minP } = isRecord(when) ? when : {};
  const id = String(gate.id);
  const name = typeof label === "string" ? label : "";
  const pathId = freeId(`${id}-${idPart(name) || "path"}`, taken);
  const otherwiseId = freeId(`${id}-otherwise`, taken);
  const escalate =
    otherwise === "escalate"
      ? [{ id: freeId(`${id}-escalate`, taken), type: "escalate", reason: ESCALATE_REASON }]
      : [];
  const branch = {
    ...own,
    mode: "first",
    paths: [
      {
        id: pathId,
        name,
        condition: { combine: "all", checks: [{ classify: step, is: label, minP }] },
        steps: upgradeSteps(steps.slice(at + 1), taken),
      },
    ],
    otherwise: { id: otherwiseId, steps: escalate },
  };
  return [...steps.slice(0, at), branch];
}

/**
 * Where an issue about the upgraded spec points in the v1 spec it came from: a step on a
 * converted path at its place in v1's one list, and the branch's check at the gate's `when`.
 * Issues about a v2 input come back as they were.
 */
export function issuesAsWritten(input: unknown, issues: SpecIssue[]): SpecIssue[] {
  if (!isRecord(input) || input.specVersion !== 1) return issues;
  return issues.map((issue) => ({ ...issue, path: v1Path(issue.path) }));
}

function v1Path(path: SpecIssue["path"]): SpecIssue["path"] {
  const [first, top, ...after] = path;
  if (first !== "steps" || typeof top !== "number") return path;
  let index = top;
  let rest = after;
  // A converted path's steps followed its gate in v1's list.
  while (rest[0] === "paths" && rest[2] === "steps" && typeof rest[3] === "number") {
    index += 1 + rest[3];
    rest = rest.slice(4);
  }
  if (rest[0] === "paths") {
    const field = WHEN_FIELDS[String(rest.at(-1))];
    return ["steps", index, "when", ...(field === undefined ? [] : [field])];
  }
  if (rest[0] === "otherwise" || rest[0] === "mode") return ["steps", index, "else"];
  return ["steps", index, ...rest];
}

/** A converted check's fields, by the v1 `when` field each came from. */
const WHEN_FIELDS: Partial<Record<string, string>> = {
  classify: "step",
  is: "label",
  minP: "minP",
};

type StepLike = Record<string, unknown>;

function isGate(step: StepLike): boolean {
  return step.type === "branch" && "when" in step;
}

/** A label as part of an ID: lowercase words joined by hyphens, or empty when it has none. */
function idPart(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function freeId(wanted: string, taken: Set<unknown>): string {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${String(n)}`;
  taken.add(id);
  return id;
}
