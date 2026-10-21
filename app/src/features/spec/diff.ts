// A structural diff of two specs, for the before/after a proposal or an edit shows: steps
// paired by ID, and the top-level settings that changed. Pure, so client code may import it.
import type { Spec, Step } from "./types";

export type StepChange = "added" | "removed" | "changed" | "unchanged";

export type StepDiff = {
  id: string;
  change: StepChange;
  /** The step in the base spec; undefined for an added one. */
  before?: Step;
  /** The step in the new spec; undefined for a removed one. */
  after?: Step;
};

export type SpecDiff = {
  /** The new spec's steps in order, each removed step where it stood in the base. */
  steps: StepDiff[];
  /** The top-level fields other than `steps` whose value changed, such as `credentials`. */
  settings: string[];
};

/** `base` is null for a new workflow: every step is added. */
export function diffSpecs(base: Spec | null, next: Spec): SpecDiff {
  const before = new Map((base?.steps ?? []).map((step) => [step.id, step]));
  const afterIds = new Set(next.steps.map((step) => step.id));
  const steps: StepDiff[] = [];
  // Removed steps go before the first kept step that followed them in the base.
  const pendingRemoved: StepDiff[] = [];
  const removedBefore = new Map<string, StepDiff[]>();
  for (const step of base?.steps ?? []) {
    if (!afterIds.has(step.id)) {
      pendingRemoved.push({ id: step.id, change: "removed", before: step });
    } else if (pendingRemoved.length > 0) {
      removedBefore.set(step.id, pendingRemoved.splice(0));
    }
  }
  for (const step of next.steps) {
    steps.push(...(removedBefore.get(step.id) ?? []));
    const old = before.get(step.id);
    const change: StepChange =
      old === undefined ? "added" : sameValue(old, step) ? "unchanged" : "changed";
    steps.push({ id: step.id, change, before: old, after: step });
  }
  steps.push(...pendingRemoved);

  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(next)]);
  keys.delete("steps");
  const settings =
    base === null
      ? []
      : [...keys].filter(
          (key) =>
            !sameValue(
              (base as Record<string, unknown>)[key],
              (next as Record<string, unknown>)[key],
            ),
        );
  return { steps, settings };
}

/** Deep equality that ignores object key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : inner,
  );
}
