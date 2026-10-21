// A proposal's changes as the graph marks them, by step and path ID. Built on `diffSpecs` for
// steps; paths are paired by ID here until the diff pairs them itself, and then only this file
// changes. Pure, so client code may import it.
import { describeCondition } from "./describe";
import { diffSpecs, sameValue } from "./diff";
import { eachStep } from "./tree";
import type { BranchStep, Path, Spec, Step } from "./types";

export type ChangeMark = "added" | "removed" | "changed" | null;

export type ChangeMarks = {
  /** A proposed step: new, changed (and what it was), or unchanged. */
  step: (id: string) => { change: ChangeMark; before: Step | undefined };
  /** A proposed path, likewise; `before` is its name and condition in words. */
  path: (id: string) => { change: ChangeMark; before: string | null };
  /** The base's steps in the list with this ID (`root`, a path's or an otherwise path's). */
  baseList: (listId: string) => readonly Step[];
  /** The base's paths of the branch with this ID. */
  basePaths: (branchId: string) => readonly Path[];
  /** The step is gone from the proposal: it's drawn struck through where it stood. */
  stepGone: (id: string) => boolean;
  pathGone: (id: string) => boolean;
};

/** The marks of `next` against `base`; a null base is a new workflow, all of it added. */
export function changeMarks(base: Spec | null, next: Spec): ChangeMarks {
  const diff = new Map(diffSpecs(base, next).steps.map((step) => [step.id, step]));
  const baseBranches = branchesOf(base);
  const nextBranches = branchesOf(next);
  const basePaths = new Map([...baseBranches].flatMap((branch) => branch.paths.map(byId)));
  const nextPaths = new Set([...nextBranches].flatMap((branch) => branch.paths.map(idOf)));
  const nextSteps = new Set(eachStep(next).map(({ step }) => step.id));
  const lists = new Map<string, readonly Step[]>([["root", base?.steps ?? []]]);
  for (const branch of baseBranches) {
    for (const path of branch.paths) lists.set(path.id, path.steps);
    lists.set(branch.otherwise.id, branch.otherwise.steps);
  }
  const branches = new Map([...baseBranches].map(byId));

  return {
    step: (id) => {
      const stepDiff = diff.get(id);
      const before = stepDiff?.before;
      if (stepDiff === undefined || before === undefined) return { change: "added", before };
      if (stepDiff.change !== "changed") return { change: null, before };
      // A branch is changed by its own fields; its paths carry their own marks.
      const after = stepDiff.after;
      const own =
        before.type !== "branch" || after?.type !== "branch" || before.mode !== after.mode;
      return own ? { change: "changed", before } : { change: null, before };
    },
    path: (id) => {
      const before = basePaths.get(id);
      const after = [...nextBranches].flatMap((branch) => branch.paths).find((p) => p.id === id);
      if (before === undefined) return { change: "added", before: null };
      if (after === undefined || sameValue(pathFields(before), pathFields(after))) {
        return { change: null, before: null };
      }
      const condition = describeCondition(before.condition);
      const renamed = before.name !== after.name;
      return { change: "changed", before: renamed ? `${before.name}: ${condition}` : condition };
    },
    baseList: (listId) => lists.get(listId) ?? [],
    basePaths: (branchId) => branches.get(branchId)?.paths ?? [],
    stepGone: (id) => !nextSteps.has(id),
    pathGone: (id) => !nextPaths.has(id),
  };
}

/** What a path's own change is about: its name and condition, not its steps. */
function pathFields(path: Path): unknown {
  return { name: path.name, condition: path.condition };
}

function branchesOf(spec: Spec | null): Set<BranchStep> {
  if (spec === null) return new Set();
  return new Set(eachStep(spec).flatMap(({ step }) => (step.type === "branch" ? [step] : [])));
}

function byId<T extends { id: string }>(item: T): [string, T] {
  return [item.id, item];
}

function idOf(item: { id: string }): string {
  return item.id;
}
