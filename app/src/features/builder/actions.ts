"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runFormAction } from "@/features/orgs/form-action";
import type { TryItState } from "@/features/runtime/types";
import type { ActionResult } from "@/lib/errors";
import { acceptProposal, rejectProposal, startConversation, tryInConversation } from "./server";
import type { BuilderUIMessage } from "./types";

const startInput = z.object({ workflowId: z.string().min(1).optional() });

/** Starts a builder conversation and opens it. */
export async function startConversationAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, startInput, startConversation, {
    after: ({ id }) => redirect(`/builder/${id}`),
  });
}

const tryInput = z.object({
  conversationId: z.string().min(1),
  connectionId: z.string().min(1),
  sourceRef: z.string().min(1),
});

/**
 * Tries the conversation's working spec on one message. The page gets the whole result; the
 * conversation gets only its content-free summary, returned as the message it now shows.
 */
export async function tryInConversationAction(
  _previous: TryItState,
  form: FormData,
): Promise<TryItState & { message?: BuilderUIMessage }> {
  return runFormAction(form, tryInput, (ctx, { conversationId, ...input }) =>
    tryInConversation(ctx, conversationId, input),
  );
}

const proposalInput = z.object({ proposalId: z.string().min(1) });

/** Accepts a proposal: saves it as the working spec, never publishing it. */
export async function acceptProposalAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const result = await runFormAction(form, proposalInput, async (ctx, { proposalId }) => {
    await acceptProposal(ctx, proposalId);
  });
  // Refreshed even when refused: a stale proposal was marked so before the refusal, so show both.
  refresh();
  return result;
}

export async function rejectProposalAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    proposalInput,
    (ctx, { proposalId }) => rejectProposal(ctx, proposalId),
    { after: refresh },
  );
}
