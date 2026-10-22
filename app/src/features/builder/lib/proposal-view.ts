// A stored proposal as the conversation shows it: what it changes, grouped by path, in plain
// words: each path's condition, each step with its fixed risk level and whether it waits for
// a review.
import { customActionWords } from "@/features/custom-actions/description";
import { applyPolicy } from "@/features/policy/engine";
import type { ActionSet, InsertedApproval, RiskLevel } from "@/features/policy/types";
import type { SubjectWords } from "@/features/spec/conditions";
import {
  describeCondition,
  describeSpec,
  specWords,
  type ActionInfo,
  type StepDescription,
} from "@/features/spec/describe";
import { diffSpecs, type PathDiff, type StepDiff } from "@/features/spec/diff";
import { readStoredSpec } from "@/features/spec/stored";
import type { Path, Spec } from "@/features/spec/types";
import type { Proposal, ProposalGroup, ProposalPath, ProposalStep } from "../types";
import type { builderProposals } from "./schema";

type ProposalRow = typeof builderProposals.$inferSelect;

/**
 * The proposal `row`, described from `actions`: the company's action set with the custom actions
 * the proposal brings.
 */
export function toProposal(row: ProposalRow, actions: ActionSet): Proposal {
  // Both sides as a version would hold them: with the approvals the policy engine inserts.
  const baseSpec = row.baseSpec === null ? null : readStoredSpec(row.baseSpec);
  const spec = readStoredSpec(row.spec);
  const before = baseSpec === null ? null : withPolicy(baseSpec, actions);
  const after = withPolicy(spec, actions);
  const diff = diffSpecs(before?.spec ?? null, after.spec);
  const beforeSteps = described(before, actions);
  const afterSteps = described(after, actions);
  const info = (name: string) => actionInfo(name, actions);
  const step = (change: StepDiff): ProposalStep[] => {
    const now = afterSteps.get(change.id);
    const then = beforeSteps.get(change.id);
    const description = change.change === "removed" ? then : (now ?? then);
    if (description === undefined) return [];
    return [
      {
        ...description,
        change: change.change,
        before: change.change === "changed" ? (then?.text ?? null) : null,
      },
    ];
  };
  return {
    id: row.id,
    conversationId: row.conversationId,
    workflowId: row.workflowId,
    name: row.name,
    summary: row.summary,
    status: row.status,
    maxRisk: row.maxRisk,
    groups: groupsOf(diff.steps, step, {
      after: specWords(after.spec, info),
      before: before === null ? undefined : specWords(before.spec, info),
    }),
    settings: diff.settings,
    spec,
    baseSpec,
    customActions: row.customActions.map((record) => customActionWords(record)),
    customActionRecords: row.customActions,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/**
 * The changed steps of each list, in the order a run reaches them: the steps before any branch,
 * then each branch's paths left to right and its otherwise path, each followed by the paths
 * nested in it. A list is left out when neither its path nor any of its steps changed.
 */
function groupsOf(
  diff: StepDiff[],
  step: (change: StepDiff) => ProposalStep[],
  words: PathWords,
): ProposalGroup[] {
  const groups: ProposalGroup[] = [];
  const walk = (steps: StepDiff[], path: ProposalPath | null) => {
    const changed = steps.filter((change) => change.change !== "unchanged").flatMap(step);
    if (changed.length > 0 || (path !== null && path.change !== "unchanged")) {
      groups.push({ path, steps: changed });
    }
    const within = path === null ? [] : [...path.within, path.name];
    for (const branch of steps) {
      for (const change of branch.paths) {
        const path = change.after ?? change.before;
        if (path !== undefined) walk(change.steps, pathOf(branch.id, change, path, within, words));
      }
      if (branch.otherwise !== null) {
        const { id, change, steps: otherwiseSteps } = branch.otherwise;
        const stops = otherwiseSteps.every((inner) => inner.change === "removed");
        walk(otherwiseSteps, {
          id,
          branchId: branch.id,
          name: "Otherwise",
          within,
          otherwise: true,
          change,
          text: stops
            ? "Runs when no other path applies, and stops the run."
            : "Runs when no other path applies.",
          before: null,
        });
      }
    }
  };
  walk(diff, null);
  return groups;
}

/** What each side's checks test, in words: the proposal's, and the spec it was made against. */
type PathWords = { after: SubjectWords; before: SubjectWords | undefined };

function pathOf(
  branchId: string,
  change: PathDiff,
  path: Path,
  within: string[],
  words: PathWords,
): ProposalPath {
  // A removed path is described as the base had it.
  const pathWords = change.change === "removed" ? words.before : words.after;
  return {
    id: change.id,
    branchId,
    name: path.name,
    within,
    otherwise: false,
    change: change.change,
    text: runsWhen(path, pathWords),
    before:
      change.change === "changed" && change.before !== undefined
        ? { name: change.before.name, text: runsWhen(change.before, words.before) }
        : null,
  };
}

function runsWhen(path: Path, words: SubjectWords | undefined): string {
  return `Runs when ${describeCondition(path.condition, words)}.`;
}

type WithPolicy = { spec: Spec; inserted: InsertedApproval[] };

// A spec `actions` no longer fully allows is shown as written.
function withPolicy(spec: Spec, actions: ActionSet): WithPolicy {
  const policy = applyPolicy(spec, actions);
  return policy.ok ? { spec: policy.spec, inserted: policy.inserted } : { spec, inserted: [] };
}

function described(
  side: WithPolicy | null,
  actions: ActionSet,
): Map<string, StepDescription<RiskLevel>> {
  if (side === null) return new Map();
  const steps = describeSpec(side.spec, {
    action: (name) => actionInfo(name, actions),
    insertedApprovals: side.inserted.map((approval) => approval.stepId),
  });
  return new Map(steps.map((step) => [step.id, step]));
}

function actionInfo(name: string, actions: ActionSet): ActionInfo<RiskLevel> | undefined {
  const action = actions.find(name);
  if (action === undefined) return undefined;
  const { risk, description, conditionFields } = action;
  return { risk, description, conditionFields };
}
