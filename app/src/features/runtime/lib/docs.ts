// Google Docs through the Nango proxy: reading a document, finding the suggestions in it, and
// sending a batchUpdate. A document's text is read inside the step or the review that uses it
// and held in memory only (invariant 8); what Mycel keeps is its ID and suggestions' IDs.
import { z } from "zod";
import { DOCUMENTS } from "@/features/connections/docs";
import { proxyGet, proxyPost } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { isRecord } from "@/lib/utils";
import { RunStepError } from "./failures";

/**
 * How a document is read: with suggestions inline (the only view whose indexes a batchUpdate
 * takes, and the one that shows them), or as it reads with none of them applied.
 */
type ViewMode = "SUGGESTIONS_INLINE" | "PREVIEW_WITHOUT_SUGGESTIONS";

// A document as documents.get gives it, every tab's content included; its content is walked,
// not parsed field by field, so a kind of element Mycel doesn't read is passed over.
const documentSchema = z.object({
  documentId: z.string(),
  title: z.string().default(""),
  tabs: z.array(z.unknown()).default([]),
});
export type DocsDocument = z.infer<typeof documentSchema>;

// One suggestion response per request: the suggestions it created, accepted or rejected.
const suggestionResponse = z.object({
  createdSuggestionIds: z.array(z.string()).default([]),
});
const batchAnswerSchema = z.object({
  suggestionResponses: z.array(suggestionResponse).default([]),
  commentUpdateState: z.string().optional(),
});
export type BatchAnswer = z.infer<typeof batchAnswerSchema>;

/** The document, every tab of it, read as `mode`; null when the account has no such document. */
export function liveDocument(
  ctx: Ctx,
  connectionId: string,
  documentId: string,
  mode: ViewMode = "SUGGESTIONS_INLINE",
): Promise<DocsDocument | null> {
  const query = new URLSearchParams({ suggestionsViewMode: mode, includeTabsContent: "true" });
  return proxyGet(
    ctx,
    connectionId,
    `${documentPath(documentId)}?${query.toString()}`,
    documentSchema,
  );
}

/** Sends a batchUpdate to the document: null when the account has no such document. */
export function batchUpdate(
  ctx: Ctx,
  connectionId: string,
  documentId: string,
  body: { requests: unknown[]; writeControl?: { writeMode: "SUGGEST" } },
): Promise<BatchAnswer | null> {
  return proxyPost(
    ctx,
    connectionId,
    `${documentPath(documentId)}:batchUpdate`,
    body,
    batchAnswerSchema,
  );
}

/**
 * Every suggestion ID in the document read with suggestions inline: those on text it would add
 * or remove (`suggested…Ids` lists), and the keys of every suggested change to a style or a
 * property (`suggested…` maps), in any tab, table, header or footer.
 */
export function suggestionIdsIn(document: DocsDocument): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, field] of Object.entries(value)) {
      if (key.startsWith("suggested") && Array.isArray(field)) {
        for (const id of field) if (typeof id === "string") ids.add(id);
      } else if (key.startsWith("suggested") && isRecord(field)) {
        for (const id of Object.keys(field)) ids.add(id);
      } else {
        walk(field);
      }
    }
  };
  walk(document.tabs);
  return ids;
}

/** One suggestion as a review shows it: the text it adds, the text it removes, a restyling. */
export type SuggestedChange = { added: string; removed: string; restyled: boolean };

/** Each of `ids` still in the document, with what it changes, in the order they appear. */
export function suggestedChanges(document: DocsDocument, ids: readonly string[]) {
  const changes = new Map<string, SuggestedChange>();
  const changeOf = (id: string) => {
    const change = changes.get(id) ?? { added: "", removed: "", restyled: false };
    changes.set(id, change);
    return change;
  };
  for (const run of textRuns(document)) {
    for (const id of run.suggestedInsertionIds ?? []) {
      if (ids.includes(id)) changeOf(id).added += run.content;
    }
    for (const id of run.suggestedDeletionIds ?? []) {
      if (ids.includes(id)) changeOf(id).removed += run.content;
    }
    for (const id of Object.keys(run.suggestedTextStyleChanges ?? {})) {
      if (ids.includes(id)) changeOf(id).restyled = true;
    }
  }
  return changes;
}

/**
 * The read-document action: the document's title, and its text as it reads with none of its
 * suggested edits applied.
 */
export async function readDocument(
  ctx: Ctx,
  connectionId: string,
  input: { documentId: string },
): Promise<{ documentId: string; title: string; text: string }> {
  const document = await docs(
    liveDocument(ctx, connectionId, input.documentId, "PREVIEW_WITHOUT_SUGGESTIONS"),
  );
  return { documentId: document.documentId, title: document.title, text: documentText(document) };
}

/** The document's text, every tab's body in order, as it reads (read without suggestions). */
export function documentText(document: DocsDocument): string {
  return textRuns(document)
    .map((run) => run.content)
    .join("");
}

const textRunSchema = z.object({
  content: z.string().default(""),
  suggestedInsertionIds: z.array(z.string()).optional(),
  suggestedDeletionIds: z.array(z.string()).optional(),
  suggestedTextStyleChanges: z.record(z.string(), z.unknown()).optional(),
});
type TextRun = z.infer<typeof textRunSchema>;

// Every text run in the document's tabs' bodies, child tabs included, in order.
function textRuns(document: DocsDocument): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (value: unknown, inBody: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inBody);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, field] of Object.entries(value)) {
      if (inBody && key === "textRun") {
        const run = textRunSchema.safeParse(field);
        if (run.success) runs.push(run.data);
      } else if (key === "body" || key === "documentTab" || key === "childTabs" || inBody) {
        walk(field, inBody || key === "body");
      }
    }
  };
  walk(document.tabs, false);
  return runs;
}

function documentPath(documentId: string): string {
  return `${DOCUMENTS}/${encodeURIComponent(documentId)}`;
}

/**
 * A Docs request's answer, or the step's failure: no such document (404) and a document the
 * account may not edit or read (403) aren't retried, since trying again gets the same answer.
 * Messages name no document or text.
 */
export async function docs<T>(request: Promise<T | null>): Promise<T> {
  let result: T | null;
  try {
    result = await request;
  } catch (error) {
    if (error instanceof SourceRequestError && error.status === 403) {
      throw new RunStepError("source_forbidden", "Docs refused access to the document.");
    }
    if (error instanceof SourceRequestError && error.status === 400) {
      throw new RunStepError("invalid_input", "Docs refused the requests.");
    }
    throw error;
  }
  if (result === null) {
    throw new RunStepError("source_item_missing", "Docs has no such document.");
  }
  return result;
}
