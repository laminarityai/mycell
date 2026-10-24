// The Docs batchUpdate requests a suggest-edits step may send (ADR-0017): each is one of Google's
// own request objects, written as suggestions. Google refuses some requests in suggest mode, and
// those are refused here, as the spec is saved, rather than by Docs in a run. So is anything that
// isn't an edit: a step that accepted, rejected or deleted suggestions, or commented, would act
// without the review. https://developers.google.com/workspace/docs/api/how-tos/suggestions
// Pure: no IO, no ctx, so client code may import it.
import { z } from "zod";

/** Every request `documents.batchUpdate` takes, by its JSON name. */
const DOCS_REQUEST_KINDS = [
  "replaceAllText",
  "insertText",
  "updateTextStyle",
  "createParagraphBullets",
  "deleteParagraphBullets",
  "createNamedRange",
  "deleteNamedRange",
  "updateParagraphStyle",
  "deleteContentRange",
  "insertInlineImage",
  "insertTable",
  "insertTableRow",
  "insertTableColumn",
  "deleteTableRow",
  "deleteTableColumn",
  "insertPageBreak",
  "deletePositionedObject",
  "updateTableColumnProperties",
  "updateTableCellStyle",
  "updateTableRowStyle",
  "replaceImage",
  "updateDocumentStyle",
  "mergeTableCells",
  "unmergeTableCells",
  "createHeader",
  "createFooter",
  "createFootnote",
  "replaceNamedRangeContent",
  "updateSectionStyle",
  "insertSectionBreak",
  "deleteHeader",
  "deleteFooter",
  "pinTableHeaderRows",
  "addDocumentTab",
  "deleteTab",
  "updateDocumentTabProperties",
  "insertPerson",
  "updateNamedStyle",
  "insertRichLink",
  "insertDate",
  "insertComment",
  "addCommentReply",
  "updateCommentPost",
  "deleteComment",
  "deleteCommentReply",
  "acceptSuggestion",
  "rejectSuggestion",
  "deleteSuggestion",
  "createDropdownDefinition",
  "updateDropdownDefinitionProperties",
  "insertDropdown",
  "updateDropdownProperties",
  "deleteDropdownDefinition",
] as const;

/** The requests Docs refuses when `writeControl.writeMode` is SUGGEST. */
export const SUGGEST_MODE_REFUSED = [
  "addDocumentTab",
  "createNamedRange",
  "deleteFooter",
  "deleteHeader",
  "deleteNamedRange",
  "deleteTab",
  "updateDocumentTabProperties",
  "updateTableColumnProperties",
] as const;

/** The document style fields Docs can't suggest a change to. */
export const UNSUGGESTABLE_STYLE_FIELDS = [
  "documentFormat",
  "useEvenPageHeaderFooter",
  "useFirstPageHeaderFooter",
] as const;

/** Requests that act on comments or suggestions rather than suggesting an edit. */
const NOT_EDITS = [
  "insertComment",
  "addCommentReply",
  "updateCommentPost",
  "deleteComment",
  "deleteCommentReply",
  "acceptSuggestion",
  "rejectSuggestion",
  "deleteSuggestion",
] as const;

const kinds: readonly string[] = DOCS_REQUEST_KINDS;
const refused: readonly string[] = SUGGEST_MODE_REFUSED;
const notEdits: readonly string[] = NOT_EDITS;

/**
 * One Docs batchUpdate request, as Google writes it: `{ "<kind>": { …its fields } }`, such as
 * `{ "insertText": { "text": "…", "endOfSegmentLocation": {} } }`. Only the kind is checked
 * here; Docs checks the rest.
 */
export const docsRequestSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .superRefine((request, ctx) => {
    const named = Object.keys(request);
    if (named.length !== 1) {
      ctx.addIssue({ code: "custom", message: "Give each request exactly one kind." });
      return;
    }
    const kind = named.join("");
    const issue = kindIssue(kind, request[kind]);
    if (issue !== undefined) ctx.addIssue({ code: "custom", message: issue, path: [kind] });
  });

/** Why a request of `kind` can't be suggested, or undefined when it can. */
function kindIssue(kind: string, fields: Record<string, unknown> | undefined): string | undefined {
  if (!kinds.includes(kind)) return `"${kind}" isn't a Docs request.`;
  if (refused.includes(kind)) return `Docs can't suggest ${kind}: it refuses it in suggest mode.`;
  if (notEdits.includes(kind)) {
    return `A suggest-edits step only suggests edits, so it can't ${kind}; its review accepts or rejects them.`;
  }
  if (kind !== "updateDocumentStyle" || typeof fields?.fields !== "string") return undefined;
  const changed = fields.fields.split(",").map((field) => field.trim().split(".")[0] ?? "");
  const unsuggestable = UNSUGGESTABLE_STYLE_FIELDS.filter(
    (field) => changed.includes(field) || changed.includes("*"),
  );
  if (unsuggestable.length === 0) return undefined;
  return `Docs can't suggest a change to ${unsuggestable.join(", ")}.`;
}
