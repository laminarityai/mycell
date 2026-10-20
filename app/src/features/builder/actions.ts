"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { startConversation } from "./server";

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
