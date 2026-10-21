// The step walker: the way a run goes through its spec's steps, shared by the interpreter and
// the dry run, so Try it goes the way a run would. It decides which step runs next and what
// each sees, and how the run ends from the way its paths ended; running a step (an Inngest step
// and its record, or in memory) is the caller's.
import type { BranchStep, Spec, Step } from "@/features/spec/types";
import type { Json } from "../types";

/** Where a step runs: its place in the order steps ran, and the outputs above it. */
export type StepPlace = { position: number; outputs: Readonly<Record<string, Json>> };

/**
 * How a step ended its path: the branch stopped it (`skipped`), it handed the message to a
 * person (`escalated`), or it `failed`. `cancelled` ends the whole run.
 */
export type StepEnding = "skipped" | "escalated" | "failed" | "cancelled";

/**
 * What running one step gave: its output for the steps after it, or how it ended its path.
 * `endsRun` makes its ending the whole run's, as running out of credits does.
 */
export type WalkedStep<Ending extends StepEnding> = {
  ended: Ending | null;
  output: Json;
  endsRun?: boolean;
};

export type RunOneStep<Ending extends StepEnding> = (
  step: Step,
  place: StepPlace,
) => Promise<WalkedStep<Ending>>;

/** How a walk ended: as its paths ended, or `partly_failed` when some failed and some didn't. */
export type WalkEnding<Ending extends StepEnding> = Ending | "succeeded" | "partly_failed";

/**
 * Runs the spec's steps through `runOne`, one after another, each seeing the outputs of the
 * steps above it on its own path, until one ends its path. After a branch, the walk goes down
 * each path the branch's output names, left to right, with the outputs as of the branch, never
 * a sibling path's; a path that ends, failed or not, leaves the paths after it to run. A step
 * that ends the whole run (`cancelled`, or `endsRun`) stops every path, and is how it ended.
 */
export async function walkSteps<Ending extends StepEnding>(
  spec: Spec,
  runOne: RunOneStep<Ending>,
): Promise<WalkEnding<Ending>> {
  let position = 0;
  // How each path that ran ended; the steps before the first branch count as the one path.
  const ends: (Ending | "succeeded")[] = [];
  /** Walks a list and the paths below it; gives the ending that stopped the run, if one did. */
  const walkList = async (
    steps: Step[],
    above: Readonly<Record<string, Json>>,
  ): Promise<Ending | null> => {
    const outputs = { ...above };
    for (const step of steps) {
      const result = await runOne(step, { position: position++, outputs: { ...outputs } });
      if (result.ended === "cancelled" || (result.ended !== null && result.endsRun === true)) {
        return result.ended;
      }
      if (result.ended !== null) {
        ends.push(result.ended);
        return null;
      }
      outputs[step.id] = result.output;
      if (step.type !== "branch") continue;
      // A branch is last in its list: its paths' endings are this list's.
      for (const path of takenPaths(step, result.output)) {
        const stopped = await walkList(path, outputs);
        if (stopped !== null) return stopped;
      }
      return null;
    }
    ends.push("succeeded");
    return null;
  };
  return (await walkList(spec.steps, {})) ?? runEnding(ends);
}

/**
 * The run's ending from its paths': `failed` when every path that ran failed (as a failure on
 * the shared steps above every branch is), `partly_failed` when only some did; otherwise
 * escalated when any path handed the message over, succeeded when any finished, else skipped.
 */
function runEnding<Ending extends StepEnding>(ends: (Ending | "succeeded")[]): WalkEnding<Ending> {
  const failed = ends.filter((end) => end === "failed");
  if (failed.length > 0) return failed.length === ends.length ? failed[0] : "partly_failed";
  return (
    ends.find((end) => end === "escalated") ??
    ends.find((end) => end === "succeeded") ??
    ends.at(0) ??
    "succeeded"
  );
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
