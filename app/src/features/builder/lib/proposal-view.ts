// A stored proposal as the conversation shows it: what it changes, grouped by path, in plain
// words: each path's condition, each step with its catalog risk level and whether it waits for
// a review.
import { findAction } from "@/features/policy/catalog";
import { applyPolicy } from "@/features/policy/engine";
import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import {
  describeCondition,
  describeSpec,
  type ActionInfo,
  type StepDescription,
} from "@/features/spec/describe";
import { diffSpecs, type PathDiff, type StepDiff } from "@/features/spec/diff";
import { readStoredSpec } from "@/features/spec/stored";
import type { Path, Spec } from "@/features/spec/types";
import type { Proposal, ProposalGroup, ProposalPath, ProposalStep } from "../types";
import type { builderProposals } from "./schema";

type ProposalRow = typeof builderProposals.$inferSelect;

export function toProposal(row: ProposalRow): Proposal {
  // Both sides as a version would hold them: with the approvals the policy engine inserts.
  const before = row.baseSpec === null ? null : withPolicy(readStoredSpec(row.baseSpec));
  const after = withPolicy(readStoredSpec(row.spec));
  const diff = diffSpecs(before?.spec ?? null, after.spec);
  const beforeSteps = described(before);
  const afterSteps = described(after);
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
    groups: groupsOf(diff.steps, step),
    settings: diff.settings,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/**
 * The changed steps of each list, in the order a run reaches them: the steps before any branch,
 * then each branch's paths left to right and its otherwise path, each followed by the paths
 * nested in it. A list is left out when neither its path nor any of its steps changed.
 */
function groupsOf(diff: StepDiff[], step: (change: StepDiff) => ProposalStep[]): ProposalGroup[] {
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
        if (path !== undefined) walk(change.steps, pathOf(branch.id, change, path, within));
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

function pathOf(branchId: string, change: PathDiff, path: Path, within: string[]): ProposalPath {
  return {
    id: change.id,
    branchId,
    name: path.name,
    within,
    otherwise: false,
    change: change.change,
    text: runsWhen(path),
    before:
      change.change === "changed" && change.before !== undefined
        ? { name: change.before.name, text: runsWhen(change.before) }
        : null,
  };
}

function runsWhen(path: Path): string {
  return `Runs when ${describeCondition(path.condition)}.`;
}

type WithPolicy = { spec: Spec; inserted: InsertedApproval[] };

// A spec the catalog no longer fully allows is shown as written.
function withPolicy(spec: Spec): WithPolicy {
  const policy = applyPolicy(spec);
  return policy.ok ? { spec: policy.spec, inserted: policy.inserted } : { spec, inserted: [] };
}

function described(side: WithPolicy | null): Map<string, StepDescription<RiskLevel>> {
  if (side === null) return new Map();
  const steps = describeSpec(side.spec, {
    action: actionInfo,
    insertedApprovals: side.inserted.map((approval) => approval.stepId),
  });
  return new Map(steps.map((step) => [step.id, step]));
}

function actionInfo(name: string): ActionInfo<RiskLevel> | undefined {
  const action = findAction(name);
  return action === undefined ? undefined : { risk: action.risk, description: action.description };
}
