// Pending runs (#182): the agent offers to run one of the person's own switched-on workflows on a
// message in their own mail, and nothing starts until they press Run. `propose_run` checks what
// `runtime`'s startRunFromAgent would, and records the offer; Run checks it all again and starts
// the run. A pending run is its conversation's, so only the conversation's owner may see or run
// it. It keeps the message's source ref only: the page fetches its sender, subject and date.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { agentRunDetails, checkRunFromAgent, startRunFromAgent } from "@/features/runtime/server";
import type { AgentRunStart } from "@/features/runtime/types";
import { workflowNames } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError, typedErrorMessage } from "@/lib/errors";
import type { PendingRun, ProposeRunRefusal, ProposeRunResult } from "../types";
import { findConversation } from "./conversations";
import { toolPrompts } from "./prompts";
import { agentPendingRuns } from "./schema";
import type { AgentToolDefinition } from "./tools";

const proposeInput = z.object({
  workflowId: z.string().trim().min(1).describe(toolPrompts.proposeRunWorkflowId()),
  messageId: z.string().trim().min(1).describe(toolPrompts.proposeRunMessageId()),
});

/** What the model reads: the result, and what to tell the person. */
type Proposed = ProposeRunResult & { message: string; workflow?: string };

export const proposeRunTool: AgentToolDefinition<z.infer<typeof proposeInput>, Proposed> = {
  description: toolPrompts.proposeRun(),
  inputSchema: proposeInput,
  async execute(ctx, { workflowId, messageId }, turn) {
    let start: AgentRunStart;
    try {
      start = await checkRunFromAgent(ctx, workflowId, messageId);
    } catch (error) {
      return { ...refusal(error), message: toolPrompts.runRefused() };
    }
    const id = randomUUID();
    await forOrg(ctx).insert(agentPendingRuns, {
      id,
      conversationId: turn.conversationId,
      workflowId: start.workflowId,
      connectionId: start.connectionId,
      sourceRef: start.sourceRef,
    });
    return {
      proposed: true,
      pendingRunId: id,
      workflow: start.workflowName,
      message: toolPrompts.runProposed(),
    };
  },
  // The pending run's ID, or the refusal's words: never the message's sender or subject.
  stored: (output): ProposeRunResult =>
    output.proposed
      ? { proposed: true, pendingRunId: output.pendingRunId }
      : { proposed: false, why: output.why },
};

// A refusal the person can act on, in its own words; anything else is a bug.
function refusal(error: unknown): ProposeRunRefusal {
  const why = typedErrorMessage(error);
  if (why === undefined) throw error;
  return { proposed: false, why };
}

/**
 * Presses Run on one of the ctx's user's pending runs: starts the run (`startRunFromAgent`,
 * which checks everything again) and records it. A pending run that started one already starts
 * nothing more, so a second click gives the same run. NotFoundError unless it's in the ctx's
 * user's own conversation.
 */
export async function runPendingRun(ctx: Ctx, pendingRunId: string): Promise<{ runId: string }> {
  const db = forOrg(ctx);
  const row = (
    await db.select(agentPendingRuns, { where: eq(agentPendingRuns.id, pendingRunId), limit: 1 })
  ).at(0);
  if (row === undefined) throw new NotFoundError("pending run");
  // NotFoundError for anyone but the conversation's owner, an admin included.
  await findConversation(ctx, row.conversationId);
  if (row.runId !== null) return { runId: row.runId };
  const { runId } = await startRunFromAgent(ctx, row.workflowId, row.sourceRef);
  await db.update(
    agentPendingRuns,
    { runId },
    and(eq(agentPendingRuns.id, row.id), isNull(agentPendingRuns.runId)),
  );
  return { runId };
}

/** A conversation's pending runs, oldest first. The caller checked it's the ctx's user's. */
export async function pendingRunsOf(ctx: Ctx, conversationId: string): Promise<PendingRun[]> {
  const rows = await forOrg(ctx).select(agentPendingRuns, {
    where: eq(agentPendingRuns.conversationId, conversationId),
    orderBy: [asc(agentPendingRuns.createdAt), asc(agentPendingRuns.id)],
  });
  if (rows.length === 0) return [];
  const [names, details] = await Promise.all([
    workflowNames(
      ctx,
      rows.map((row) => row.workflowId),
    ),
    agentRunDetails(ctx, rows),
  ]);
  return rows.map((row, i) => ({
    id: row.id,
    workflowId: row.workflowId,
    workflowName: names.get(row.workflowId) ?? "Deleted workflow",
    message: details[i]?.message ?? null,
    run: details[i]?.run ?? null,
    createdAt: row.createdAt,
  }));
}
