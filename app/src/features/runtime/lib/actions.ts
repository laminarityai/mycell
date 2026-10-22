// Every catalog action's executor, typed so that a catalog action without one fails the
// typecheck. The tool step checks each one's input and output against the catalog's schemas.
// Actions not built yet are pending, with the ticket that builds them.
import { messageRef, threadRef } from "./gmail";
import { gmailDraftAdapter } from "./gmail-draft-adapter";
import { addLabel } from "./gmail-labels";
import { appendRow, readRange } from "./sheets";
import type { ActionExecutors } from "./step-context";

export const actionExecutors: ActionExecutors = {
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
  // The draft is Gmail's pending form: its adapter prepares it.
  "google-mail.create-draft": {
    status: "ready",
    run: async (ctx, connectionId, input: { messageId: string }, marker, compose) => {
      const { messageId } = input;
      const prepared = await gmailDraftAdapter.prepare(ctx, {
        connectionId,
        messageId,
        marker,
        compose,
      });
      return { draftId: prepared.itemRef, threadId: prepared.threadRef };
    },
  },
  // Records the range's counts; a draft step that names it re-reads the values (invariant 8).
  "google-sheet.read-range": { status: "ready", run: readRange },
  "google-sheet.append-row": { status: "ready", run: appendRow },
};
