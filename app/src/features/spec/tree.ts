// A spec's steps as a tree: the root list, and each branch's paths with their own lists. Every
// reader that needs "every step", "this step", or "what this step may use" goes through these
// helpers rather than walking `spec.steps`, so the shape of the tree is known here only. Pure,
// so client code may import it.
import type { Spec, SpecIssue, Step } from "./types";

/** A step, where it sits in the spec, and the steps above it on its own path. */
export type PlacedStep = {
  step: Step;
  /** The JSON location of the step in the spec, as issues name it: `["steps", 2]`. */
  location: SpecIssue["path"];
  /** The steps a run reaches before this one on its way here, outermost first. */
  above: Step[];
};

/**
 * Every step at every depth, each placed, in the order a run reaches them: a branch, then each
 * of its paths left to right, then its otherwise path.
 */
export function eachStep(spec: Spec): PlacedStep[] {
  const placed: PlacedStep[] = [];
  const walk = (location: SpecIssue["path"], steps: Step[], above: Step[]) => {
    steps.forEach((step, index) => {
      const at = [...location, index];
      const before = [...above, ...steps.slice(0, index)];
      placed.push({ step, location: at, above: before });
      if (step.type !== "branch") return;
      // A step on a path sees the branch and what's above it, never a sibling path's steps.
      step.paths.forEach((path, p) => {
        walk([...at, "paths", p, "steps"], path.steps, [...before, step]);
      });
      walk([...at, "otherwise", "steps"], step.otherwise.steps, [...before, step]);
    });
  };
  walk(["steps"], spec.steps, []);
  return placed;
}

/** The step with this ID, at any depth (step IDs are unique across the spec). */
export function findStep(spec: Spec, stepId: string): Step | undefined {
  return placeOf(spec, stepId)?.step;
}

/** What the step may use: the steps above it on its own path. None for an unknown ID. */
export function stepsAbove(spec: Spec, stepId: string): Step[] {
  return placeOf(spec, stepId)?.above ?? [];
}

/** Where the step sits in the spec, as an issue about it names it. */
export function stepLocation(spec: Spec, stepId: string): SpecIssue["path"] | undefined {
  return placeOf(spec, stepId)?.location;
}

/**
 * The spec with `change` applied to every list of steps in it, innermost first; the rest of
 * the spec is as it was. For a rewrite that inserts or removes steps, such as the policy
 * engine's approvals.
 */
export function mapStepLists(spec: Spec, change: (steps: Step[]) => Step[]): Spec {
  const mapList = (steps: Step[]): Step[] =>
    change(
      steps.map((step) =>
        step.type === "branch"
          ? {
              ...step,
              paths: step.paths.map((path) => ({ ...path, steps: mapList(path.steps) })),
              otherwise: { ...step.otherwise, steps: mapList(step.otherwise.steps) },
            }
          : step,
      ),
    );
  return { ...spec, steps: mapList(spec.steps) };
}

function placeOf(spec: Spec, stepId: string): PlacedStep | undefined {
  return eachStep(spec).find(({ step }) => step.id === stepId);
}
