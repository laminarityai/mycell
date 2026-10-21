// A stored proposal as the conversation shows it: the before/after of its steps in plain words,
// each with its catalog risk level and whether it waits for a review.
import { findAction } from "@/features/policy/catalog";
import { applyPolicy } from "@/features/policy/engine";
import type { InsertedApproval, RiskLevel } from "@/features/policy/types";
import { describeSpec, type ActionInfo, type StepDescription } from "@/features/spec/describe";
import { diffSpecs } from "@/features/spec/diff";
import { readStoredSpec } from "@/features/spec/stored";
import type { Spec } from "@/features/spec/types";
import type { Proposal, ProposalStep } from "../types";
import type { builderProposals } from "./schema";

type ProposalRow = typeof builderProposals.$inferSelect;

export function toProposal(row: ProposalRow): Proposal {
  // Both sides as a version would hold them: with the approvals the policy engine inserts.
  const before = row.baseSpec === null ? null : withPolicy(readStoredSpec(row.baseSpec));
  const after = withPolicy(readStoredSpec(row.spec));
  const diff = diffSpecs(before?.spec ?? null, after.spec);
  const beforeSteps = described(before);
  const afterSteps = described(after);
  const steps = diff.steps.flatMap((step): ProposalStep[] => {
    const now = afterSteps.get(step.id);
    const then = beforeSteps.get(step.id);
    const description = now ?? then;
    if (description === undefined) return [];
    return [
      {
        ...description,
        change: step.change,
        before: step.change === "changed" ? (then?.text ?? null) : null,
      },
    ];
  });
  return {
    id: row.id,
    conversationId: row.conversationId,
    workflowId: row.workflowId,
    name: row.name,
    summary: row.summary,
    status: row.status,
    maxRisk: row.maxRisk,
    steps,
    settings: diff.settings,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
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
