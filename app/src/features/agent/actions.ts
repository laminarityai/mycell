"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteToldFact, restoreToldFact } from "@/features/memory/server";
import type { DeletedToldFact } from "@/features/memory/types";
import { runFormAction, runValueAction } from "@/features/orgs/form-action";
import type { ActionResult } from "@/lib/errors";
import { deleteConversation, runPendingRun, startConversation } from "./server";

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

const toldFactId = z.string().min(1);

/**
 * Deletes one of the person's told facts ("What I've told Mycel"): Mycel stops using it at
 * once, and the page offers Undo until the window ends.
 */
export async function deleteToldFactAction(
  factId: unknown,
): Promise<{ deleted: DeletedToldFact } | ActionResult> {
  return runValueAction(factId, toldFactId, deleteToldFact, {
    after: (deleted) => {
      refresh();
      return { deleted };
    },
  });
}

/** Brings back the told fact the person just deleted. */
export async function restoreToldFactAction(factId: unknown): Promise<ActionResult> {
  return runValueAction(factId, toldFactId, restoreToldFact, { after: refresh });
}

const pendingRunInput = z.object({ pendingRunId: z.string().min(1) });

/**
 * Run, on a run the agent offered: starts it on the person's own inbox, checked again first, and
 * shows how it's going. Pressed twice, it starts nothing more.
 */
export async function runPendingRunAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    pendingRunInput,
    async (ctx, { pendingRunId }) => {
      await runPendingRun(ctx, pendingRunId);
    },
    { after: refresh },
  );
}
