// A structural diff of two specs, for the before/after a proposal or an edit shows: a tree like
// the spec's own, with steps paired by ID within each list and paths paired by ID within each
// branch, and the top-level settings that changed. Pure, so client code may import it.
import type { OtherwisePath, Path, Spec, Step } from "./types";

export type Change = "added" | "removed" | "changed" | "unchanged";
/** A step's change. */
export type StepChange = Change;

export type StepDiff = {
  id: string;
  change: Change;
  /** The step in the base spec; undefined for an added one. */
  before?: Step;
  /** The step in the new spec; undefined for a removed one. */
  after?: Step;
  /**
   * A branch's paths, left to right as the new spec has them, each removed one where it stood
   * in the base. Empty for any other step.
   */
  paths: PathDiff[];
  /** A branch's otherwise path; null for any other step. */
  otherwise: OtherwiseDiff | null;
};

/** A path: changed when its name or condition is; its steps are diffed on their own. */
export type PathDiff = {
  id: string;
  change: Change;
  before?: Path;
  after?: Path;
  steps: StepDiff[];
};

/** An otherwise path: only its steps can change. */
export type OtherwiseDiff = {
  id: string;
  change: Change;
  steps: StepDiff[];
};

export type SpecDiff = {
  /**
   * The new spec's top-level steps in order, each removed one where it stood in the base, and
   * each branch's paths below it. A step that moved to another list is removed from the one it
   * left and added to the one it joined.
   */
  steps: StepDiff[];
  /** The top-level fields other than `steps` whose value changed, such as `credentials`. */
  settings: string[];
};

/**
 * `base` is null for a new workflow: every step and path is added. A branch is changed only
 * when its own fields are (its mode), not when one of its paths is.
 */
export function diffSpecs(base: Spec | null, next: Spec): SpecDiff {
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
  return { steps: diffSteps(base?.steps ?? [], next.steps), settings };
}

function diffSteps(base: Step[], next: Step[]): StepDiff[] {
  return pairById(base, next).map(({ id, before, after }) => {
    const branchBefore = before?.type === "branch" ? before : undefined;
    const branchAfter = after?.type === "branch" ? after : undefined;
    return {
      id,
      change: changeOf(before, after, ownFields),
      before,
      after,
      paths: diffPaths(branchBefore?.paths ?? [], branchAfter?.paths ?? []),
      otherwise: diffOtherwise(branchBefore?.otherwise, branchAfter?.otherwise),
    };
  });
}

function diffPaths(base: Path[], next: Path[]): PathDiff[] {
  return pairById(base, next).map(({ id, before, after }) => ({
    id,
    change: changeOf(before, after, withoutSteps),
    before,
    after,
    steps: diffSteps(before?.steps ?? [], after?.steps ?? []),
  }));
}

function diffOtherwise(
  before: OtherwisePath | undefined,
  after: OtherwisePath | undefined,
): OtherwiseDiff | null {
  const either = after ?? before;
  if (either === undefined) return null;
  return {
    id: either.id,
    change: changeOf(before, after, withoutSteps),
    steps: diffSteps(before?.steps ?? [], after?.steps ?? []),
  };
}

function changeOf<T>(
  before: T | undefined,
  after: T | undefined,
  own: (item: T) => unknown,
): Change {
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  return sameValue(own(before), own(after)) ? "unchanged" : "changed";
}

/**
 * The new list's items paired with the base's by ID, in the new order, each item only the base
 * has placed before the first kept item that followed it there, or at the end.
 */
function pairById<T extends { id: string }>(
  base: T[],
  next: T[],
): { id: string; before?: T; after?: T }[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const afterIds = new Set(next.map((item) => item.id));
  const pending: { id: string; before: T }[] = [];
  const removedBefore = new Map<string, { id: string; before: T }[]>();
  for (const item of base) {
    if (!afterIds.has(item.id)) {
      pending.push({ id: item.id, before: item });
    } else if (pending.length > 0) {
      removedBefore.set(item.id, pending.splice(0));
    }
  }
  return [
    ...next.flatMap((item) => [
      ...(removedBefore.get(item.id) ?? []),
      { id: item.id, before: before.get(item.id), after: item },
    ]),
    ...pending,
  ];
}

/** A step without its paths, which are diffed on their own. */
function ownFields(step: Step): unknown {
  if (step.type !== "branch") return step;
  return { ...step, paths: undefined, otherwise: undefined };
}

/** A path without its steps, which are diffed on their own. */
function withoutSteps(path: Path | OtherwisePath): unknown {
  return { ...path, steps: undefined };
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
