"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runFormAction } from "@/features/orgs/form-action";
import type { ActionResult } from "@/lib/errors";
import { deleteConversation, startConversation } from "./server";

/** Starts a conversation (or reuses the person's empty one) and opens it. */
export async function startConversationAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, z.object({}), (ctx) => startConversation(ctx), {
    after: ({ id }) => redirect(`/ask/${id}`),
  });
}

const conversationInput = z.object({ conversationId: z.string().min(1) });

/** Deletes one of the person's conversations, with its messages, and goes back to Ask Mycel. */
export async function deleteConversationAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    conversationInput,
    (ctx, { conversationId }) => deleteConversation(ctx, conversationId),
    { after: () => redirect("/ask") },
  );
}
