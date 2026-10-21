// The step walker: the way a run goes through its spec's steps, shared by the interpreter and
// the dry run, so Try it goes the way a run would. It decides which step runs next and what
// each sees; running a step (an Inngest step and its record, or in memory) is the caller's.
import type { Spec, Step } from "@/features/spec/types";
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
 * steps above it, until one ends the run. Returns how the run ended: that step's ending, or
 * `succeeded` when every step went on.
 */
export async function walkSteps<Ending extends string>(
  spec: Spec,
  runOne: RunOneStep<Ending>,
): Promise<Ending | "succeeded"> {
  const outputs: Record<string, Json> = {};
  let position = 0;
  // A v1 spec is one list. From specVersion 2 a branch's output names the paths it took, and
  // each is walked here with a copy of the outputs as of the branch, never a sibling's.
  for (const step of spec.steps) {
    const result = await runOne(step, { position: position++, outputs: { ...outputs } });
    if (result.ended !== null) return result.ended;
    outputs[step.id] = result.output;
  }
  return "succeeded";
}
