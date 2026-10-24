// The suggested-edits adapter (ADR-0013, ADR-0017): a step's edits wait in the Doc as
// suggestions. Approving accepts the step's suggestions still there and declining rejects them,
// all together; the person's own suggestions, which carry the same name, are never touched, since
// the review acts only on the IDs Docs gave the step's. The person may also accept or reject
// them in Docs, one by one: once none of them remains, the review is done in the app. Accepting
// takes edit access to the doc, so without it the review offers only the doc's link. The doc and
// the suggested text are read live and held in memory only (invariant 8).
import { z } from "zod";
import { documentLink } from "@/features/connections/docs";
import { FILES } from "@/features/connections/drive";
import { proxyGet } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ItemGoneError, ValidationError } from "@/lib/errors";
import {
  batchUpdate,
  liveDocument,
  suggestedChanges,
  suggestionIdsIn,
  type DocsDocument,
} from "./docs";
import type { PendingFormAdapter, PendingItem } from "./pending-forms";
import { suggestEdits, type SuggestEditsInput } from "./suggested-edits";

/** What the suggest-edits action hands `prepare`: the edits, and the run step making them. */
export type SuggestInput = {
  connectionId: string;
  /** The run and step making them (`<runId>/<stepId>`), so a retry finds its earlier ones. */
  marker: string;
  input: SuggestEditsInput;
};

const capabilitiesSchema = z.object({ capabilities: z.object({ canEdit: z.boolean() }) });

export const suggestedEditsAdapter: PendingFormAdapter<SuggestInput> = {
  // The edits, suggested once per run step. The review is named by the first suggestion, waits
  // on the doc, and keeps every suggestion's ID; a step that suggested nothing has no review.
  async prepare(ctx, { connectionId, marker, input }) {
    const { documentId, suggestionIds } = await suggestEdits(ctx, connectionId, input, marker);
    const first = suggestionIds.at(0);
    if (first === undefined) return { itemRef: documentId, threadRef: documentId };
    const details = { kind: "suggested_edits" as const, suggestionIds };
    return { itemRef: first, threadRef: documentId, details };
  },

  async approve(ctx, item, edits) {
    if (edits !== undefined) {
      throw new ValidationError("Suggested edits are approved as they are; change them in Docs.");
    }
    await handle(ctx, item, "acceptSuggestion");
  },

  async decline(ctx, item) {
    await handle(ctx, item, "rejectSuggestion");
  },

  // Gone with its doc; done in the app once every one of its suggestions was accepted or
  // rejected in Docs.
  async check(ctx, item) {
    const document = await liveDocument(ctx, item.connectionId, docOf(item));
    if (document === null) return "gone";
    return remaining(document, item).length === 0 ? "done_in_app" : "waiting";
  },

  // The doc's title and link, what each of the step's suggestions still in it changes, and
  // whether the person may accept them.
  async view(ctx, item) {
    const document = await liveDocument(ctx, item.connectionId, docOf(item));
    if (document === null) throw new ItemGoneError();
    const ids = remaining(document, item);
    if (ids.length === 0) throw new ItemGoneError();
    return {
      kind: "suggested_edits",
      title: document.title,
      link: documentLink(document.documentId),
      changes: [...suggestedChanges(document, ids).values()],
      canEdit: await canEdit(ctx, item),
    };
  },
};

// Accepts or rejects the step's suggestions still in the doc, in one batch. ItemGoneError when
// the doc, or every one of them, is gone.
async function handle(
  ctx: Ctx,
  item: PendingItem,
  how: "acceptSuggestion" | "rejectSuggestion",
): Promise<void> {
  const document = await liveDocument(ctx, item.connectionId, docOf(item));
  if (document === null) throw new ItemGoneError();
  const ids = remaining(document, item);
  if (ids.length === 0) throw new ItemGoneError();
  const requests = ids.map((suggestionId) => ({ [how]: { suggestionId } }));
  let answer;
  try {
    answer = await batchUpdate(ctx, item.connectionId, docOf(item), { requests });
  } catch (error) {
    if (error instanceof SourceRequestError && error.status === 403) {
      throw new ValidationError(
        "This account can't edit the doc, so its suggestions can only be accepted in Docs by someone who can.",
      );
    }
    throw error;
  }
  if (answer === null) throw new ItemGoneError();
  if (answer.commentUpdateState === "ALL_FAILED_UNKNOWN_REASON") {
    throw new ConflictError("Docs didn't save that. Open the doc to check its suggestions.");
  }
}

// The step's suggestions still in the document, in the order the step made them.
function remaining(document: DocsDocument, item: PendingItem): string[] {
  const present = suggestionIdsIn(document);
  const ids = item.details?.kind === "suggested_edits" ? item.details.suggestionIds : [];
  return ids.filter((id) => present.has(id));
}

// The doc the suggestions wait in: the review's thread.
function docOf(item: PendingItem): string {
  return item.threadRef;
}

// Whether the account may edit the doc, as Drive says; null when Drive can't say (its app not
// granted, say), and approving then finds out.
async function canEdit(ctx: Ctx, item: PendingItem): Promise<boolean | null> {
  const path = `${FILES}/${encodeURIComponent(docOf(item))}?fields=capabilities(canEdit)&supportsAllDrives=true`;
  try {
    const file = await proxyGet(ctx, item.connectionId, path, capabilitiesSchema);
    return file?.capabilities.canEdit ?? null;
  } catch (error) {
    if (error instanceof SourceRequestError) return null;
    throw error;
  }
}
