// A spec in plain words, for admins who don't read JSON: one sentence per step, the risk level
// of the action it uses, and whether it waits for a person's review. Pure, so client code may
// import it. `spec` doesn't know the catalog (policy imports spec), so callers pass what it
// says about each action, and which approvals the policy engine inserted.
import { describeCheck } from "./conditions";
import { eachStep } from "./tree";
import type { BranchStep, Condition, Spec, Step } from "./types";

/** What the caller knows about one catalog action. */
export type ActionInfo<Risk extends string = string> = { risk: Risk; description: string };

export type DescribeOptions<Risk extends string = string> = {
  /** The catalog's entry for an action; undefined for one it doesn't have. */
  action?: (name: string) => ActionInfo<Risk> | undefined;
  /** The IDs of the approval steps the policy engine inserted. */
  insertedApprovals?: readonly string[];
};

export type StepDescription<Risk extends string = string> = {
  id: string;
  type: Step["type"];
  text: string;
  /** The risk level of the action the step uses; null for a step that uses none. */
  risk: Risk | null;
  /** The step is where a person reviews what waits in a pending form. */
  waitsForReview: boolean;
  /** The policy engine inserted the step: it can't be removed. */
  requiredByPolicy: boolean;
};

export function describeSpec<Risk extends string = string>(
  spec: Spec,
  options: DescribeOptions<Risk> = {},
): StepDescription<Risk>[] {
  const inserted = new Set(options.insertedApprovals ?? []);
  return eachStep(spec).map(({ step }) => {
    const name = step.type === "tool" ? step.action : step.type === "draft" ? step.output : null;
    const action = name === null ? undefined : options.action?.(name);
    return {
      id: step.id,
      type: step.type,
      text: describeStep(step, action?.description),
      risk: action?.risk ?? null,
      waitsForReview: step.type === "approval",
      requiredByPolicy: inserted.has(step.id),
    };
  });
}

/** One step as a sentence; `actionDescription` is the catalog's words for its action. */
export function describeStep(step: Step, actionDescription?: string): string {
  switch (step.type) {
    case "classify":
      return `Asks "${step.question}" and picks one of: ${step.labels.join(", ")}.`;
    case "branch":
      return describeBranch(step);
    case "extract":
      return `Reads ${Object.keys(step.fields).join(", ")} from the message.`;
    case "tool":
      return actionDescription ?? `Runs ${step.action}.`;
    case "draft": {
      const what = actionDescription?.replace(/\.$/, "") ?? `Writes a reply with ${step.output}`;
      return `${what}: "${step.instructions}"`;
    }
    case "approval":
      return "Waits for a person to review the Gmail drafts before they go anywhere.";
    case "escalate":
      return `Hands the message to a person: ${step.reason}`;
  }
}

/**
 * A branch as a sentence: "Goes on only if …" for one first-match path, as a v1 gate read;
 * otherwise each path by name with its condition.
 */
function describeBranch(step: BranchStep): string {
  const steps = step.otherwise.steps;
  const otherwise =
    steps.length === 0
      ? "stops"
      : steps.length === 1 && steps.at(0)?.type === "escalate"
        ? "hands the message to a person"
        : "takes the otherwise path";
  const only = step.paths.at(0);
  if (step.mode === "first" && step.paths.length === 1 && only !== undefined) {
    return `Goes on only if ${describeCondition(only.condition)}; otherwise ${otherwise}.`;
  }
  const which = step.mode === "first" ? "the first path" : "every path";
  const paths = step.paths.map((path) => `"${path.name}" if ${describeCondition(path.condition)}`);
  return `Takes ${which} that applies, checked left to right: ${paths.join("; ")}; otherwise ${otherwise}.`;
}

/** A condition in plain words: its checks joined by "and" (all of them) or "or" (any). */
export function describeCondition(condition: Condition): string {
  return condition.checks.map(describeCheck).join(condition.combine === "all" ? " and " : " or ");
}
