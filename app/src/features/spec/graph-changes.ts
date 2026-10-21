// A proposal's changes as the graph marks them, by step and path ID, read from `diffSpecs`'
// tree diff. The graph draws each step once, so a step or path that moved to another list is
// drawn only where it went, marked as the diff marks it there (added). Pure, so client code may
// import it.
import type { SubjectWords } from "./conditions";
import { describeCondition } from "./describe";
import { diffSpecs, type PathDiff, type StepDiff } from "./diff";
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

/**
 * The marks of `next` against `base`; a null base is a new workflow, all of it added. `words`
 * names what the base's checks test.
 */
export function changeMarks(base: Spec | null, next: Spec, words?: SubjectWords): ChangeMarks {
  const steps = new Map<string, StepDiff>();
  const paths = new Map<string, PathDiff>();
  const collect = (list: StepDiff[]) => {
    for (const step of list) {
      // A moved step is removed from the list it left; the graph marks it where it went.
      if (step.change !== "removed") steps.set(step.id, step);
      for (const path of step.paths) {
        if (path.change !== "removed") paths.set(path.id, path);
        collect(path.steps);
      }
      if (step.otherwise !== null) collect(step.otherwise.steps);
    }
  };
  collect(diffSpecs(base, next).steps);

  const baseBranches = branchesOf(base);
  const nextPaths = new Set([...branchesOf(next)].flatMap((branch) => branch.paths.map(idOf)));
  const nextSteps = new Set(eachStep(next).map(({ step }) => step.id));
  const lists = new Map<string, readonly Step[]>([["root", base?.steps ?? []]]);
  for (const branch of baseBranches) {
    for (const path of branch.paths) lists.set(path.id, path.steps);
    lists.set(branch.otherwise.id, branch.otherwise.steps);
  }
  const branches = new Map([...baseBranches].map((branch) => [branch.id, branch]));

  return {
    step: (id) => {
      const diff = steps.get(id);
      if (diff === undefined || diff.change === "added") {
        return { change: "added", before: undefined };
      }
      // A branch is changed by its own fields (its mode); its paths carry their own marks.
      return { change: diff.change === "changed" ? "changed" : null, before: diff.before };
    },
    path: (id) => {
      const diff = paths.get(id);
      if (diff === undefined || diff.change === "added") return { change: "added", before: null };
      const before = diff.before;
      if (diff.change !== "changed" || before === undefined) return { change: null, before: null };
      const condition = describeCondition(before.condition, words);
      const renamed = before.name !== diff.after?.name;
      return { change: "changed", before: renamed ? `${before.name}: ${condition}` : condition };
    },
    baseList: (listId) => lists.get(listId) ?? [],
    basePaths: (branchId) => branches.get(branchId)?.paths ?? [],
    stepGone: (id) => !nextSteps.has(id),
    pathGone: (id) => !nextPaths.has(id),
  };
}

function branchesOf(spec: Spec | null): Set<BranchStep> {
  if (spec === null) return new Set();
  return new Set(eachStep(spec).flatMap(({ step }) => (step.type === "branch" ? [step] : [])));
}

function idOf(item: { id: string }): string {
  return item.id;
}
