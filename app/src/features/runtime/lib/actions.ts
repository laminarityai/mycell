// Every catalog action's executor, typed so that a catalog action without one fails the
// typecheck. The tool step checks each one's input and output against the catalog's schemas.
// Actions not built yet are pending, with the ticket that builds them.
import { calendarEventAdapter } from "./calendar-event-adapter";
import { readEvent, type Booking } from "./calendar-events";
import { readDocument } from "./docs";
import { RunStepError } from "./failures";
import { messageWithText, threadRef } from "./gmail";
import { gmailDraftAdapter } from "./gmail-draft-adapter";
import { addLabel } from "./gmail-labels";
import { lookUp, type LookupInput } from "./memory-lookup";
import { appendRow, readRange } from "./sheets";
import type { ActionExecutors } from "./step-context";
import type { SuggestEditsInput } from "./suggested-edits";
import { suggestedEditsAdapter } from "./suggested-edits-adapter";
import { InvariantError } from "@/lib/errors";
import { createTask, listTasks, updateTask, type NewTask, type TaskChanges } from "./tasks";

export const actionExecutors: ActionExecutors = {
  "google-mail.read-message": {
    status: "ready",
    run: async (ctx, connectionId, input: { messageId: string }) => {
      const { id, ...message } = await messageWithText(ctx, connectionId, input.messageId);
      return { messageId: id, ...message };
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
  // Hands on the range's counts; a draft step that names it re-reads the values.
  "google-sheet.read-range": { status: "ready", run: readRange },
  "google-sheet.append-row": { status: "ready", run: appendRow },
  // Its title and text pass to later steps, never into run records (ADR-0021).
  "google-docs.read-document": { status: "ready", run: readDocument },
  // The edits wait in the doc as suggestions: Docs' pending form, which its adapter prepares.
  // It hands on the document's ID and the suggestions' IDs, for the approval.
  "google-docs.suggest-edits": {
    status: "ready",
    run: async (ctx, connectionId, input: SuggestEditsInput, marker) => {
      const prepared = await suggestedEditsAdapter.prepare(ctx, { connectionId, marker, input });
      const { details } = prepared;
      return {
        documentId: prepared.threadRef,
        suggestionIds: details?.kind === "suggested_edits" ? details.suggestionIds : [],
      };
    },
  },
  // The event's details pass to later steps, never into run records (ADR-0021).
  "google-calendar.read-event": { status: "ready", run: readEvent },
  // The event waits on the calendar with no guests: Calendar's pending form, which its adapter
  // prepares. It hands on the guests and how the event shows once approved, for the approval.
  "google-calendar.create-event": {
    status: "ready",
    run: async (ctx, connectionId, booking: Booking, marker) => {
      const prepared = await calendarEventAdapter.prepare(ctx, { connectionId, marker, booking });
      const { details } = prepared;
      if (details?.kind !== "calendar_event") {
        throw new InvariantError("A booking kept no guests.");
      }
      return {
        eventId: prepared.itemRef,
        guests: details.guests,
        visibility: details.visibility,
        transparency: details.transparency,
      };
    },
  },
  // On the person's default list; a task's title and notes leave the step only as its ID.
  "google-tasks.list-tasks": {
    status: "ready",
    run: (ctx, connectionId) => listTasks(ctx, connectionId),
  },
  "google-tasks.create-task": {
    status: "ready",
    run: (ctx, connectionId, input: NewTask, marker, _compose, run) =>
      createTask(ctx, connectionId, input, marker, run),
  },
  "google-tasks.update-task": {
    status: "ready",
    run: (ctx, connectionId, input: TaskChanges, _marker, _compose, run) =>
      updateTask(ctx, connectionId, input, run),
  },
  // Reads as the run: in its member's view, or company-wide only (memory-lookup.ts).
  "memory.lookup": {
    status: "ready",
    run: async (ctx, connectionId, input: LookupInput, _marker, _compose, run) => {
      if (run.workflowId === undefined) {
        throw new RunStepError("not_available", "Only a workflow's run can look up memory.");
      }
      const reader = { kind: "workflow_run" as const, runId: run.id, workflowId: run.workflowId };
      return lookUp(ctx, { connectionId, sourceRef: run.sourceRef }, input, reader);
    },
  },
};
