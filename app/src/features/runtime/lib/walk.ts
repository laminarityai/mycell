// The step walker: the way a run goes through its spec's steps, shared by the interpreter and
// the dry run, so Try it goes the way a run would. It decides which step runs next and what
// each sees; running a step (an Inngest step and its record, or in memory) is the caller's.
import type { BranchStep, Spec, Step } from "@/features/spec/types";
import type { Json } from "../types";

/** Where a step runs: its place in the order steps ran, and the outputs above it. */
export type StepPlace = { position: number; outputs: Readonly<Record<string, Json>> };

/** What running one step gave: its output for the steps after it, or how it ended the run. */
export type WalkedStep<Ending extends string> = { ended: Ending | null; output: Json };

export type RunOneStep<Ending extends string> = (
  step: Step,
  place: StepPlace,
) => Promise<WalkedStep<Ending>>;

/**
 * Runs the spec's steps through `runOne`, one after another, each seeing the outputs of the
 * steps above it on its own path, until one ends the run. After a branch, the walk goes down
 * each path the branch's output names, with the outputs as of the branch, never a sibling
 * path's. Returns how the run ended: that step's ending, or `succeeded` when every step went on.
 */
export async function walkSteps<Ending extends string>(
  spec: Spec,
  runOne: RunOneStep<Ending>,
): Promise<Ending | "succeeded"> {
  let position = 0;
  const walkList = async (
    steps: Step[],
    above: Readonly<Record<string, Json>>,
  ): Promise<Ending | null> => {
    const outputs = { ...above };
    for (const step of steps) {
      const result = await runOne(step, { position: position++, outputs: { ...outputs } });
      if (result.ended !== null) return result.ended;
      outputs[step.id] = result.output;
      if (step.type !== "branch") continue;
      for (const path of takenPaths(step, result.output)) {
        const ended = await walkList(path, outputs);
        if (ended !== null) return ended;
      }
    }
    return null;
  };
  return (await walkList(spec.steps, {})) ?? "succeeded";
}

/** The step lists of the paths a branch's output says it took, in the order they run. */
function takenPaths(branch: BranchStep, output: Json): Step[][] {
  if (!isRecord(output)) return [];
  const { taken, passed } = output;
  if (Array.isArray(taken)) {
    const lists = new Map([
      ...branch.paths.map((path): [Json, Step[]] => [path.id, path.steps]),
      [branch.otherwise.id, branch.otherwise.steps],
    ]);
    return taken.flatMap((id) => {
      const list = lists.get(id);
      return list === undefined ? [] : [list];
    });
  }
  // A run memoized part-way through a v1 version holds its gate's result, `{ passed }`. The
  // gate is now a branch with the same ID, whose one path holds the steps the gate went on to.
  if (typeof passed === "boolean") {
    const list = passed ? branch.paths.at(0)?.steps : branch.otherwise.steps;
    return list === undefined ? [] : [list];
  }
  return [];
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
