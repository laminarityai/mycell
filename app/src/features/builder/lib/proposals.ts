// Proposals: the agent's suggested changes, validated before an admin sees them, and accepted
// or rejected by an admin. Accepting saves the working spec over the revision the proposal was
// made against, and never publishes; a working spec that moved on since marks it stale, and
// nothing is merged.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { actionSetWith } from "@/features/custom-actions/description";
import { listCustomActions } from "@/features/custom-actions/server";
import { readStoredSpec } from "@/features/spec/stored";
import type { SpecIssue } from "@/features/spec/types";
import {
  checkWorkflowSave,
  checkWorkflowSpec,
  getWorkflow,
  listWorkflows,
  saveWorkflowIn,
} from "@/features/workflows/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Proposal, ProposalStatus, ProposeSpecResult } from "../types";
import { findConversation } from "./conversations";
import { toolResultPrompts } from "./prompts";
import { toProposal } from "./proposal-view";
import { builderConversations, builderProposals } from "./schema";
import type { TurnInfo } from "./tools";

/** Failed `propose_spec` calls a turn allows before the admin is shown the issues. */
export const MAX_FAILED_PROPOSALS = 3;

export type ProposeSpecInput = { workflowId?: string; spec: unknown; summary: string };

/**
 * Validates the spec as saving would, against the workflow's working spec as it is now (the
 * conversation's workflow unless `workflowId` names another), and stores it as a proposal.
 * Issues go back to the model to repair; after three failures in a turn it is told to stop.
 */
export async function proposeSpec(
  ctx: Ctx,
  input: ProposeSpecInput,
  turn: TurnInfo,
): Promise<ProposeSpecResult> {
  if (turn.failedProposals >= MAX_FAILED_PROPOSALS) return gaveUp([]);
  const workflowId = input.workflowId ?? turn.workflowId ?? undefined;
  // NotFoundError, for the model, when it names another org's workflow or none at all.
  const base = workflowId === undefined ? undefined : await getWorkflow(ctx, workflowId);
  // With the custom actions this turn described, as if they were stored.
  const check = await checkWorkflowSpec(ctx, input.spec, turn.customActions);
  const issues: SpecIssue[] = check.ok ? await specIdIssues(ctx, check.working.id, base?.id) : [];
  if (!check.ok || issues.length > 0) {
    turn.failedProposals += 1;
    const all = check.ok ? issues : check.issues;
    if (turn.failedProposals >= MAX_FAILED_PROPOSALS) return gaveUp(all);
    return {
      ok: false,
      gaveUp: false,
      issues: all,
      message: toolResultPrompts.proposalNotStored(),
    };
  }

  const id = randomUUID();
  await forOrg(ctx).insert(builderProposals, {
    id,
    conversationId: turn.conversationId,
    workflowId: base?.id ?? null,
    baseRevision: base?.revision ?? null,
    baseSpec: base?.workingSpec ?? null,
    spec: check.working,
    name: base?.name ?? nameFor(check.working.id),
    summary: input.summary,
    maxRisk: check.maxRisk,
    inserted: check.inserted,
    // Only those the spec uses: the rest go with the turn.
    customActions: turn.customActions.filter((action) =>
      check.requiredActions.includes(action.name),
    ),
  });
  return {
    ok: true,
    proposalId: id,
    message: toolResultPrompts.proposalStored(),
  };
}

function gaveUp(issues: SpecIssue[]): ProposeSpecResult {
  return {
    ok: false,
    gaveUp: true,
    issues,
    message: toolResultPrompts.proposalsGaveUp(),
  };
}

// A spec ID is unique in the org: one another workflow has can't be saved.
async function specIdIssues(ctx: Ctx, specId: string, workflowId?: string): Promise<SpecIssue[]> {
  const taken = (await listWorkflows(ctx)).find(
    (workflow) => workflow.specId === specId && workflow.id !== workflowId,
  );
  if (taken === undefined) return [];
  return [
    {
      path: ["id"],
      message: `The workflow "${taken.name}" already has the spec ID "${specId}". Choose another ID, or propose a change to that workflow with its workflowId.`,
    },
  ];
}

// "pricing-replies" becomes "Pricing replies".
function nameFor(specId: string): string {
  const words = specId.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The conversation's proposals, oldest first. */
export async function listProposals(ctx: Ctx, conversationId: string): Promise<Proposal[]> {
  requireAdmin(ctx);
  const conversation = await findConversation(ctx, conversationId);
  const rows = await forOrg(ctx).select(builderProposals, {
    where: eq(builderProposals.conversationId, conversation.id),
    orderBy: [asc(builderProposals.createdAt), asc(builderProposals.id)],
  });
  // Each proposal is drawn with the custom actions it brings, which aren't stored until accepted.
  const stored = await listCustomActions(ctx);
  return rows.map((row) => toProposal(row, actionSetWith([...stored, ...row.customActions])));
}

/**
 * Saves the proposal as the workflow's working spec: a new, unpublished workflow, which the
 * conversation is then about, or the existing one's working spec, never its published version.
 * Throws ConflictError, and marks the proposal stale, when the working spec changed since.
 */
export async function acceptProposal(
  ctx: Ctx,
  proposalId: string,
): Promise<{ workflowId: string }> {
  requireAdmin(ctx);
  const row = await openProposal(ctx, proposalId);
  // Everything saving reads and checks comes first: the transaction queries only through `tx`.
  const save = await checkWorkflowSave(ctx, {
    workflowId: row.workflowId ?? undefined,
    name: row.name,
    spec: readStoredSpec(row.spec),
    baseRevision: row.baseRevision ?? undefined,
    // Its custom actions are stored with the spec, or not at all.
    newCustomActions:
      row.customActions.length === 0
        ? undefined
        : { actions: row.customActions, proposalId: row.id },
  });
  const newWorkflow = row.workflowId === null;
  try {
    // The working spec, the decision and the conversation's link land together, or none does
    // and the proposal stays open to accept again.
    return await forOrg(ctx).transaction(async (tx) => {
      const saved = await saveWorkflowIn(ctx, tx, save);
      await decide(ctx, row.id, "accepted", { workflowId: saved.id }, tx);
      // A conversation is about one workflow: the first accepted proposal links it.
      if (newWorkflow) {
        await tx.update(
          builderConversations,
          { workflowId: saved.id, updatedAt: new Date() },
          and(
            eq(builderConversations.id, row.conversationId),
            isNull(builderConversations.workflowId),
          ),
        );
      }
      return { workflowId: saved.id };
    });
  } catch (error) {
    // A new workflow has no working spec to have moved on.
    if (row.workflowId === null || !(error instanceof ConflictError)) throw error;
    const current = await getWorkflow(ctx, row.workflowId);
    if (current.revision === row.baseRevision) throw error;
    await decide(ctx, row.id, "stale");
    throw new ConflictError(
      "The workflow changed after this proposal was made, so it wasn't saved. Ask the builder to propose again from the current working spec.",
    );
  }
}

/** Rejects the proposal; nothing changes. */
export async function rejectProposal(ctx: Ctx, proposalId: string): Promise<void> {
  requireAdmin(ctx);
  const row = await openProposal(ctx, proposalId);
  await decide(ctx, row.id, "rejected");
}

type ProposalRow = typeof builderProposals.$inferSelect;

// The proposal, still waiting for a decision.
async function openProposal(ctx: Ctx, proposalId: string): Promise<ProposalRow> {
  const rows = await forOrg(ctx).select(builderProposals, {
    where: eq(builderProposals.id, proposalId),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("proposal");
  if (row.status !== "proposed") {
    throw new ConflictError(`This proposal was already ${STATUS_WORDS[row.status]}.`);
  }
  return row;
}

const STATUS_WORDS: Record<ProposalStatus, string> = {
  proposed: "proposed",
  accepted: "accepted",
  rejected: "rejected",
  stale: "found out of date",
};

// Through `db`, which accepting passes its transaction as.
async function decide(
  ctx: Ctx,
  proposalId: string,
  status: ProposalStatus,
  extra: { workflowId?: string } = {},
  db: OrgScopedDb = forOrg(ctx),
): Promise<void> {
  await db.update(
    builderProposals,
    { ...extra, status, decidedBy: ctx.userId, decidedAt: new Date() },
    eq(builderProposals.id, proposalId),
  );
}
