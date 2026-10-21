// Editing a spec on the workflow graph: each edit names the step, path or list it changes by
// ID and returns a new spec, leaving the one it was given as it was. An edit may leave the spec
// invalid (a path with no checks, a blank question); validation says what's wrong, where.
// Pure, so client code may import it.
import { eachStep, mapStepLists } from "./tree";
import type { BranchStep, Path, Spec, Step } from "./types";

/**
 * Where a new step goes: a list (`root`, or a path's ID) and the step it follows there, or
 * null for the top of the list.
 */
export type InsertAt = { list: string; after: string | null };

/**
 * The spec with `step` inserted. A branch ends its list, since paths never join, so the steps
 * below a new branch move onto its otherwise path, after any it already has: nothing built is
 * lost, and a message no path takes goes on as before.
 */
export function insertStep(spec: Spec, at: InsertAt, step: Step): Spec {
  return editList(spec, at.list, (steps) => {
    const index = at.after === null ? 0 : steps.findIndex((s) => s.id === at.after) + 1;
    const below = steps.slice(index);
    if (step.type !== "branch") return [...steps.slice(0, index), step, ...below];
    const otherwise = { ...step.otherwise, steps: [...step.otherwise.steps, ...below] };
    return [...steps.slice(0, index), { ...step, otherwise }];
  });
}

/** The spec with the step with this ID, at any depth, replaced by what `change` makes of it. */
export function updateStep(spec: Spec, stepId: string, change: (step: Step) => Step): Spec {
  return mapStepLists(spec, (steps) =>
    steps.map((step) => (step.id === stepId ? change(step) : step)),
  );
}

/**
 * The spec without the step with this ID. A branch goes with every step on its named paths,
 * but its otherwise path's steps move back into its list where it stood, as inserting a branch
 * moved them there: inserting a branch and removing it gives back the same spec.
 */
export function removeStep(spec: Spec, stepId: string): Spec {
  return mapStepLists(spec, (steps) =>
    steps.flatMap((step) => {
      if (step.id !== stepId) return [step];
      return step.type === "branch" ? step.otherwise.steps : [];
    }),
  );
}

/** The spec with `path` added to the branch, last before its otherwise path. */
export function addPath(spec: Spec, branchId: string, path: Path): Spec {
  return editBranch(spec, branchId, (branch) => ({ ...branch, paths: [...branch.paths, path] }));
}

/** The spec without the path with this ID, and the steps on it. */
export function removePath(spec: Spec, pathId: string): Spec {
  const branch = branchOf(spec, pathId);
  if (branch === undefined) return spec;
  return editBranch(spec, branch.id, (step) => ({
    ...step,
    paths: step.paths.filter((path) => path.id !== pathId),
  }));
}

/** The spec with the path moved one place left (-1) or right (1); unchanged at either end. */
export function movePath(spec: Spec, pathId: string, by: -1 | 1): Spec {
  const branch = branchOf(spec, pathId);
  if (branch === undefined) return spec;
  const index = branch.paths.findIndex((path) => path.id === pathId);
  const to = index + by;
  const path = branch.paths.at(index);
  const other = branch.paths.at(to);
  if (path === undefined || other === undefined || to < 0) return spec;
  const paths = [...branch.paths];
  paths[to] = path;
  paths[index] = other;
  return editBranch(spec, branch.id, (step) => ({ ...step, paths }));
}

/** The spec with the path with this ID replaced by what `change` makes of it. */
export function updatePath(spec: Spec, pathId: string, change: (path: Path) => Path): Spec {
  const branch = branchOf(spec, pathId);
  if (branch === undefined) return spec;
  return editBranch(spec, branch.id, (step) => ({
    ...step,
    paths: step.paths.map((path) => (path.id === pathId ? change(path) : path)),
  }));
}

/** The spec with the branch running the first path that holds, or every one. */
export function setBranchMode(spec: Spec, branchId: string, mode: BranchStep["mode"]): Spec {
  return editBranch(spec, branchId, (branch) => ({ ...branch, mode }));
}

/** The branch one of whose paths (not its otherwise path) has this ID. */
export function branchOf(spec: Spec, pathId: string): BranchStep | undefined {
  for (const { step } of eachStep(spec)) {
    if (step.type === "branch" && step.paths.some((path) => path.id === pathId)) return step;
  }
  return undefined;
}

function editBranch(spec: Spec, branchId: string, change: (branch: BranchStep) => Step): Spec {
  return updateStep(spec, branchId, (step) => (step.type === "branch" ? change(step) : step));
}

/** The spec with `change` applied to the list with this ID: `root`, or a path's. */
function editList(spec: Spec, listId: string, change: (steps: Step[]) => Step[]): Spec {
  const inList = (steps: Step[]): Step[] =>
    steps.map((step) => {
      if (step.type !== "branch") return step;
      return {
        ...step,
        paths: step.paths.map((path) => ({
          ...path,
          steps: path.id === listId ? change(path.steps) : inList(path.steps),
        })),
        otherwise: {
          ...step.otherwise,
          steps:
            step.otherwise.id === listId
              ? change(step.otherwise.steps)
              : inList(step.otherwise.steps),
        },
      };
    });
  return { ...spec, steps: listId === "root" ? change(spec.steps) : inList(spec.steps) };
}
