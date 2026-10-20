// Every catalog action's executor, typed so that a catalog action without one fails the
// typecheck. The tool step checks each one's input and output against the catalog's schemas.
// Actions not built yet are pending, with the ticket that builds them.
import type { ActionName } from "@/features/policy/catalog";
import { messageRef, threadRef } from "./gmail";
import { createReplyDraft } from "./gmail-drafts";
import { addLabel } from "./gmail-labels";
import type { ActionRun, Executor } from "./step-context";

export const actionExecutors: Record<ActionName, Executor<ActionRun>> = {
  "google-mail.read-message": {
    status: "ready",
    run: async (ctx, connectionId, input: { messageId: string }) => {
      const ref = await messageRef(ctx, connectionId, input.messageId);
      return { messageId: ref.id, threadId: ref.threadId, labelIds: ref.labelIds };
    },
  },
  "google-mail.read-thread": {
    status: "ready",
    run: async (ctx, connectionId, input: { threadId: string }) => {
      const thread = await threadRef(ctx, connectionId, input.threadId);
      return { threadId: thread.id, messageCount: thread.messages.length };
    },
  },
  "google-mail.add-label": { status: "ready", run: addLabel },
  // Run by a draft step, which hands it the generated text; a tool step may not send (policy).
  "google-mail.create-draft": { status: "ready", run: createReplyDraft },
  "google-sheet.read-range": { status: "pending", ticket: "#40" },
  "google-sheet.append-row": { status: "pending", ticket: "#40" },
};
