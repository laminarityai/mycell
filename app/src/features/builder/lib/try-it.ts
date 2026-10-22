// Try it from the builder chat: a dry run of the conversation's workflow's working spec on one
// message, whose full result goes back to the admin's page, and whose content-free summary is
// posted to the conversation as the admin's, so the agent can react to it on the next turn.
import { randomUUID } from "node:crypto";
import { getActionSet } from "@/features/custom-actions/server";
import { dryRun } from "@/features/runtime/server";
import type { DryRunResult } from "@/features/runtime/types";
import { getWorkflow } from "@/features/workflows/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import type { BuilderUIMessage } from "../types";
import { appendMessage, findConversation } from "./conversations";
import { summarizeTryIt } from "./try-it-summary";

export type TryItInConversation = {
  result: DryRunResult;
  /** The summary as the conversation now shows it. */
  message: BuilderUIMessage;
};

export async function tryInConversation(
  ctx: Ctx,
  conversationId: string,
  input: { connectionId: string; sourceRef: string },
): Promise<TryItInConversation> {
  requireAdmin(ctx);
  const conversation = await findConversation(ctx, conversationId);
  if (conversation.workflowId === null) {
    throw new ValidationError("Accept a proposal first: there's no working spec to try yet.");
  }
  const workflow = await getWorkflow(ctx, conversation.workflowId);
  const result = await dryRun(ctx, workflow.workingSpec, { ...input, workflowId: workflow.id });
  const summary = summarizeTryIt(result, workflow.workingSpec, await getActionSet(ctx));
  const id = randomUUID();
  await appendMessage(ctx, conversation, {
    id,
    role: "user",
    parts: [{ type: "try_it", ...summary }],
  });
  return { result, message: { id, role: "user", parts: [{ type: "data-tryIt", data: summary }] } };
}
