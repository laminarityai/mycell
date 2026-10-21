"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { TryItState } from "@/features/runtime/types";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { acceptProposal, rejectProposal, startConversation, tryInConversation } from "./server";
import type { BuilderUIMessage } from "./types";

const startInput = z.object({ workflowId: z.string().min(1).optional() });

/** Starts a builder conversation and opens it. */
export async function startConversationAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  let id: string;
  try {
    const input = parseForm(startInput, form);
    ({ id } = await startConversation(ctx, input));
  } catch (error) {
    return actionError(error);
  }
  redirect(`/builder/${id}`);
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
  const ctx = await getCtx();
  try {
    const { conversationId, ...input } = parseForm(tryInput, form);
    return await tryInConversation(ctx, conversationId, input);
  } catch (error) {
    return actionError(error);
  }
}

const proposalInput = z.object({ proposalId: z.string().min(1) });

/** Accepts a proposal: saves it as the working spec, never publishing it. */
export async function acceptProposalAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { proposalId } = parseForm(proposalInput, form);
    await acceptProposal(ctx, proposalId);
  } catch (error) {
    // A stale proposal was marked so before the refusal: show both.
    refresh();
    return actionError(error);
  }
  refresh();
  return {};
}

export async function rejectProposalAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { proposalId } = parseForm(proposalInput, form);
    await rejectProposal(ctx, proposalId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
