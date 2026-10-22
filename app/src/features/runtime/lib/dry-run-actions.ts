// A dry run's action executors: the read actions run for real, and every action that would
// change an app (internal_reversible and external_send) is a stub that reads what it needs and
// reports what it would have done, writing nothing. A custom write reports the exact request it
// would send, and holds nothing. Each one reports to `report`, and returns an
// output that passes the catalog's schema, so later steps run as they would.
import type { DryRunEffect } from "../types";
import { actionExecutors } from "./actions";
import { renderCustomCall, type HoldSend } from "./custom-action";
import { RunStepError } from "./failures";
import { messageRef } from "./gmail";
import { replyTarget } from "./gmail-drafts";
import { rangeRows, readRange } from "./sheets";
import type { ActionExecutors } from "./step-context";

/** What stands in for a write's ID: nothing was made. */
export const DRY_RUN_ID = "dry-run";

type Cell = string | number | boolean | null;

export function dryRunActions(report: (effect: DryRunEffect) => void): ActionExecutors {
  return {
    "google-mail.read-message": actionExecutors["google-mail.read-message"],
    "google-mail.read-thread": actionExecutors["google-mail.read-thread"],
    "google-sheet.read-range": {
      status: "ready",
      run: async (ctx, connectionId, input: { spreadsheetId: string; range: string }) => {
        const counts = await readRange(ctx, connectionId, input);
        const rows = await rangeRows(ctx, connectionId, input);
        report({ kind: "rows_read", range: counts.range, rows });
        return counts;
      },
    },
    "google-mail.add-label": {
      status: "ready",
      run: async (ctx, connectionId, input: { messageId: string; label: string }) => {
        const message = await messageRef(ctx, connectionId, input.messageId);
        report({ kind: "label", label: input.label });
        return { messageId: message.id, labelId: DRY_RUN_ID };
      },
    },
    "google-mail.create-draft": {
      status: "ready",
      run: async (ctx, connectionId, input: { messageId: string }, _marker, compose) => {
        if (compose === undefined) {
          throw new RunStepError("not_available", "Only a draft step can make a draft.");
        }
        const target = await replyTarget(ctx, connectionId, input.messageId);
        const text = await compose();
        report({ kind: "draft", to: target.to, subject: target.subject, text });
        return { draftId: DRY_RUN_ID, threadId: target.threadId };
      },
    },
    "google-sheet.append-row": {
      status: "ready",
      run: (_ctx, _connectionId, input: { range: string; values: Cell[] }) => {
        report({ kind: "row", range: input.range, values: input.values });
        return Promise.resolve({ updatedRange: input.range });
      },
    },
  };
}

/** A custom write in Try it: the exact request it would send, reported, and nothing held. */
export function dryRunHoldSend(report: (effect: DryRunEffect) => void): HoldSend {
  return async (ctx, run, _stepId, action, input) => {
    const { connectionId, request } = await renderCustomCall(ctx, run.connectionId, action, input);
    report({
      kind: "request",
      app: action.app,
      action: action.name,
      method: request.method,
      url: request.url,
      body: request.body ?? null,
    });
    return { heldSendId: DRY_RUN_ID, connectionId };
  };
}
