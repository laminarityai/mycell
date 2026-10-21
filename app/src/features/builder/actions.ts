"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { acceptProposal, rejectProposal, startConversation } from "./server";

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
