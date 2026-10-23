// A dry run's action executors: the read actions run for real, and every action that would
// change an app (internal_reversible and external_send) is a stub that reads what it needs and
// reports what it would have done, writing nothing. A custom write reports the exact request it
// would send, and holds nothing. Each one reports to `report`, and returns an
// output that passes the catalog's schema, so later steps run as they would.
import { isRecord } from "@/lib/utils";
import type { DryRunEffect } from "../types";
import { actionExecutors } from "./actions";
import { renderCustomCall, type HoldSend } from "./custom-action";
import { docs, liveDocument } from "./docs";
import { RunStepError } from "./failures";
import { messageRef } from "./gmail";
import { replyTarget } from "./gmail-drafts";
import { lookUp, type LookupInput } from "./memory-lookup";
import { rangeRows, readRange } from "./sheets";
import type { ActionExecutors } from "./step-context";
import type { SuggestEditsInput } from "./suggested-edits";

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
    "google-docs.read-document": actionExecutors["google-docs.read-document"],
    // Reads the doc, to name it, and reports each edit it would suggest; suggests nothing.
    "google-docs.suggest-edits": {
      status: "ready",
      run: async (ctx, connectionId, input: SuggestEditsInput) => {
        const document = await docs(liveDocument(ctx, connectionId, input.documentId));
        const { documentId, title } = document;
        report({ kind: "suggestions", documentId, title, requests: input.requests.map(described) });
        return { documentId, suggestionIds: [] };
      },
    },
    // A read, so it runs for real, in the view a run on the connection would have. Try it is
    // part of building, so its read is logged as the builder's.
    "memory.lookup": {
      status: "ready",
      run: (ctx, connectionId, input: LookupInput, _marker, _compose, run) =>
        lookUp(ctx, { connectionId, sourceRef: run.sourceRef }, input, { kind: "builder" }),
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

/**
 * A Docs request as Try it shows it: its kind, with the text it would insert, or what it would
 * replace and with what. Shown to the admin only, never stored.
 */
function described(request: Record<string, unknown>): string {
  const [kind, fields] = Object.entries(request).at(0) ?? ["", undefined];
  const text = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : "");
  if (!isRecord(fields)) return kind;
  if (kind === "insertText") return `${kind} ${text(fields.text)}`;
  if (kind === "replaceAllText") {
    const find = isRecord(fields.containsText) ? fields.containsText.text : undefined;
    return `${kind} ${text(find)} with ${text(fields.replaceText)}`;
  }
  return kind;
}
