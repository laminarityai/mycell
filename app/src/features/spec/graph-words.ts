// The words on a graph's step box: its kind, the app it acts in, one plain line, its risk level
// and its review. Pure, so client code may import it.
import { describeStep } from "./describe";
import type { GraphActionInfo, GraphStep } from "./graph";
import type { BranchStep, Step, StepType } from "./types";

export type StepWords<Risk extends string> = Pick<
  GraphStep<Risk>,
  "id" | "type" | "title" | "app" | "text" | "risk" | "review"
>;

const TITLES: Record<StepType, string> = {
  classify: "Classify",
  extract: "Extract",
  tool: "Action",
  draft: "Draft a reply",
  approval: "Waits for review",
  escalate: "Hand to a person",
  branch: "Branch",
};

/**
 * A step's words, given the catalog's entry for each action and the IDs of the approvals the
 * policy engine inserted.
 */
export function stepWords<Risk extends string>(
  action: ((name: string) => GraphActionInfo<Risk> | undefined) | undefined,
  inserted: ReadonlySet<string>,
): (step: Step) => StepWords<Risk> {
  return (step) => {
    const name = step.type === "tool" ? step.action : step.type === "draft" ? step.output : null;
    const info = name === null ? undefined : action?.(name);
    return {
      id: step.id,
      type: step.type,
      title: titleOf(step, info),
      app: info?.app ?? null,
      text: step.type === "branch" ? branchLine(step) : describeStep(step, info?.description),
      risk: info?.risk ?? null,
      review: step.type !== "approval" ? null : inserted.has(step.id) ? "policy" : "spec",
    };
  };
}

function titleOf(step: Step, info: GraphActionInfo | undefined): string {
  if (step.type === "branch") {
    return `Branch · ${step.mode === "first" ? "first match" : "every match"}`;
  }
  if (step.type !== "tool") return TITLES[step.type];
  const verb = step.action.split(".").at(-1)?.replaceAll("-", " ") ?? step.action;
  return info?.app === undefined ? verb : `${info.app} · ${verb}`;
}

/** A branch's one line; each path's condition is written on the path. */
function branchLine(step: BranchStep): string {
  return step.mode === "first"
    ? "Runs the first path that applies, checked left to right."
    : "Runs every path that applies, one after another, left to right.";
}
