// A fake Google Docs, served through the fake Nango's proxy on the Docs host. It answers
// documents.get and documents.batchUpdate in the shapes Google documents, from documents a test
// seeds, and keeps Google's rules: documents.get serves only the SUGGESTIONS_INLINE and
// PREVIEW_WITHOUT_SUGGESTIONS views; in suggest mode (`writeControl.writeMode: SUGGEST`) every
// edit is a suggestion, whose IDs come back in `suggestionResponses`, and the requests Google
// refuses there are answered 400; a batch is all or nothing; accepting a suggestion takes edit
// access, rejecting one edit access or being its author, and suggesting comment access. Mycel
// writes as the person, so Mycel's suggestions and the person's own carry the same author; the
// fake keeps apart those made through the API and those a test made as the person, in Docs.
// It logs every batchUpdate, and can be told to lose the next one's answer (503) or to make it
// but answer ALL_FAILED_UNKNOWN_REASON, as Google may when saving suggestions fails.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import { z } from "zod";
import type { FakeDrive } from "./fake-drive";
import { DocsRequestError, FakeDocBody } from "./fake-docs-body";

/** The account's access to a document: editor, commenter (may suggest) or viewer. */
export type DocAccess = "edit" | "comment" | "view";

/** A document to seed. Its Drive file is seeded too, shared with the account as `access`. */
export type FakeDocInput = { id?: string; title: string; text: string; access?: DocAccess };

/** One batchUpdate Mycel asked for, as it was sent, whether or not Docs made it. */
export type FakeDocsWrite = { documentId: string; requests: unknown[]; writeMode: string };

type Doc = {
  id: string;
  title: string;
  access: DocAccess;
  body: FakeDocBody;
  revision: number;
  // Who made each suggestion: through the API (Mycel), or the person in Docs.
  origins: Map<string, "api" | "person">;
};

const REFUSED_IN_SUGGEST_MODE = [
  "addDocumentTab",
  "createNamedRange",
  "deleteFooter",
  "deleteHeader",
  "deleteNamedRange",
  "deleteTab",
  "updateDocumentTabProperties",
  "updateTableColumnProperties",
];
const UNSUGGESTABLE_STYLE_FIELDS = [
  "documentFormat",
  "useEvenPageHeaderFooter",
  "useFirstPageHeaderFooter",
];

const batchSchema = z.object({
  requests: z.array(z.record(z.string(), z.record(z.string(), z.unknown()))).min(1),
  writeControl: z.strictObject({ writeMode: z.enum(["EDIT", "SUGGEST"]).optional() }).optional(),
});

export class FakeDocs {
  private docs = new Map<string, Doc>();
  /** Every batchUpdate asked for, in order. */
  readonly writes: FakeDocsWrite[] = [];
  private answersToLose = 0;
  private savesToFail = 0;

  constructor(private readonly drive: FakeDrive) {}

  /** Seeds a document, and its Drive file, owned by someone else unless the account edits it. */
  add(input: FakeDocInput): string {
    const id = input.id ?? `1doc${randomUUID().replaceAll("-", "")}`;
    const access = input.access ?? "edit";
    this.docs.set(id, {
      id,
      title: input.title,
      access,
      body: new FakeDocBody(input.text),
      revision: 1,
      origins: new Map(),
    });
    const role = access === "edit" ? "writer" : access === "comment" ? "commenter" : "reader";
    const email = this.drive.emailAddress;
    this.drive.add({
      id,
      name: input.title,
      mimeType: "application/vnd.google-apps.document",
      at: new Date(),
      owners: ["owner@elsewhere.test"],
      sharedWith: [{ type: "user", emailAddress: email, role }],
    });
    return id;
  }

  /** The document's text as it reads with no suggestion accepted. */
  text(id: string): string {
    return this.doc(id).body.text();
  }

  /** The suggestions in the document made through the API: Mycel's. */
  mycelSuggestions(id: string): string[] {
    return this.suggestions(id, "api");
  }

  /** The suggestions in the document the person made in Docs. */
  ownSuggestions(id: string): string[] {
    return this.suggestions(id, "person");
  }

  /** The person suggests inserting `text` at the end, in Docs. Returns the suggestion's ID. */
  suggestInDocs(id: string, text: string): string {
    const doc = this.doc(id);
    const suggestion = suggestionId();
    doc.body.insert(text, "end", suggestion);
    doc.origins.set(suggestion, "person");
    doc.revision += 1;
    return suggestion;
  }

  /** The person accepts or rejects a suggestion in Docs. */
  handleInDocs(id: string, suggestion: string, how: "accept" | "reject"): void {
    const doc = this.doc(id);
    if (!(how === "accept" ? doc.body.accept(suggestion) : doc.body.reject(suggestion))) {
      throw new Error(`No suggestion ${suggestion} in ${id}`);
    }
    doc.revision += 1;
  }

  /** The person edits the document directly in Docs: a new revision. */
  editInDocs(id: string, text: string): void {
    const doc = this.doc(id);
    doc.body.insert(text, "end", undefined);
    doc.revision += 1;
  }

  /** The document is deleted: Docs answers 404 for it. */
  remove(id: string): void {
    this.docs.delete(id);
  }

  /** The next batchUpdate is made, but answered 503, as when its answer is lost on the way back. */
  loseNextAnswer(): void {
    this.answersToLose += 1;
  }

  /**
   * The next batchUpdate changes the document but saves none of its suggestions: its edits land
   * directly, and Docs answers `commentUpdateState: ALL_FAILED_UNKNOWN_REASON`.
   */
  failNextSuggestionSave(): void {
    this.savesToFail += 1;
  }

  /** documents.get: `GET /v1/documents/{id}`. */
  respond(path: string, params: URLSearchParams): Response {
    const id = documentId(path);
    if (id === undefined || id.endsWith(":batchUpdate")) return docsError(404, "NOT_FOUND");
    const mode = params.get("suggestionsViewMode");
    if (mode !== "SUGGESTIONS_INLINE" && mode !== "PREVIEW_WITHOUT_SUGGESTIONS") {
      throw new Error(`The fake Docs serves only two views, not ${String(mode)}`);
    }
    const doc = this.docs.get(id);
    if (doc === undefined) return docsError(404, "NOT_FOUND");
    const body = { content: doc.body.content(mode) };
    const tabs = params.get("includeTabsContent") === "true";
    return HttpResponse.json({
      documentId: doc.id,
      title: doc.title,
      revisionId: revisionId(doc),
      suggestionsViewMode: mode,
      ...(tabs
        ? {
            tabs: [
              { tabProperties: { tabId: "t.0", title: "Tab 1", index: 0 }, documentTab: { body } },
            ],
          }
        : { body }),
    });
  }

  /** documents.batchUpdate: `POST /v1/documents/{id}:batchUpdate`. */
  write(path: string, body: unknown): Response {
    const id = /^(.*):batchUpdate$/.exec(documentId(path) ?? "")?.at(1);
    if (id === undefined) throw new Error(`The fake Docs takes no write to ${path}`);
    const batch = batchSchema.parse(body);
    const writeMode = batch.writeControl?.writeMode ?? "EDIT";
    this.writes.push({ documentId: id, requests: batch.requests, writeMode });
    const doc = this.docs.get(id);
    if (doc === undefined) return docsError(404, "NOT_FOUND");
    try {
      const failSave = writeMode === "SUGGEST" && this.savesToFail > 0;
      if (failSave) this.savesToFail -= 1;
      const answer = this.apply(doc, batch.requests, writeMode, failSave);
      if (this.answersToLose > 0) {
        this.answersToLose -= 1;
        return docsError(503, "UNAVAILABLE");
      }
      return HttpResponse.json({
        documentId: id,
        replies: answer.replies,
        writeControl: { requiredRevisionId: revisionId(doc) },
        suggestionResponses: failSave ? batch.requests.map(() => ({})) : answer.suggestions,
        commentUpdateState: failSave
          ? "ALL_FAILED_UNKNOWN_REASON"
          : answer.suggestions.some((one) => Object.keys(one).length > 0)
            ? "ALL_SAVED"
            : "NO_UPDATES_REQUESTED",
      });
    } catch (error) {
      if (!(error instanceof DocsRequestError)) throw error;
      return docsError(
        error.status,
        error.status === 403 ? "PERMISSION_DENIED" : "INVALID_ARGUMENT",
        error.message,
      );
    }
  }

  // Applies the batch to a copy of the body, and keeps it only if every request succeeds. With
  // `unsaved`, suggest mode's edits land directly, as when Docs fails to save the suggestions.
  private apply(
    doc: Doc,
    requests: Record<string, Record<string, unknown>>[],
    mode: string,
    unsaved: boolean,
  ) {
    const body = doc.body.clone();
    const origins = new Map<string, "api" | "person">();
    const replies: unknown[] = [];
    const suggestions: Record<string, string[]>[] = [];
    for (const request of requests) {
      const [kind, fields] = Object.entries(request)[0] ?? ["", {}];
      const created: string[] = [];
      const next = mode === "SUGGEST" && !unsaved ? () => record(created, origins) : undefined;
      if (kind === "acceptSuggestion" || kind === "rejectSuggestion") {
        const suggestion = String(fields.suggestionId);
        this.mayHandle(doc, kind);
        if (!(kind === "acceptSuggestion" ? body.accept(suggestion) : body.reject(suggestion))) {
          throw new DocsRequestError(400, "Invalid requests[0]: The suggestion ID is invalid.");
        }
        const key = kind === "acceptSuggestion" ? "acceptedSuggestionIds" : "rejectedSuggestionIds";
        replies.push({});
        suggestions.push({ [key]: [suggestion] });
        continue;
      }
      this.mayEdit(doc, mode);
      replies.push(edit(body, kind, fields, mode, next));
      suggestions.push(created.length === 0 ? {} : { createdSuggestionIds: created });
    }
    doc.body = body;
    for (const [id, origin] of origins) doc.origins.set(id, origin);
    doc.revision += 1;
    return { replies, suggestions };
  }

  private mayEdit(doc: Doc, mode: string): void {
    if (doc.access === "edit" || (doc.access === "comment" && mode === "SUGGEST")) return;
    throw new DocsRequestError(403, "The caller does not have permission");
  }

  // Accepting takes edit access; rejecting edit access or being the author, which the account
  // is of every suggestion the fake holds.
  private mayHandle(doc: Doc, kind: string): void {
    if (doc.access === "edit" || (doc.access === "comment" && kind === "rejectSuggestion")) return;
    throw new DocsRequestError(403, "The caller does not have permission");
  }

  private suggestions(id: string, origin: "api" | "person"): string[] {
    const doc = this.doc(id);
    return [...doc.body.suggestionIds()].filter((s) => (doc.origins.get(s) ?? "person") === origin);
  }

  private doc(id: string): Doc {
    const doc = this.docs.get(id);
    if (doc === undefined) throw new Error(`The fake Docs has no document ${id}`);
    return doc;
  }
}

// One edit request, made directly or as suggestions (each new one from `next`): what Docs
// replies. Suggest mode refuses what Google's does; a request the fake doesn't model fails the test.
function edit(
  body: FakeDocBody,
  kind: string,
  fields: Record<string, unknown>,
  mode: string,
  next: (() => string) | undefined,
): unknown {
  if (mode === "SUGGEST" && REFUSED_IN_SUGGEST_MODE.includes(kind)) {
    throw new DocsRequestError(
      400,
      `Invalid requests[0].${kind}: Not supported in suggestions mode.`,
    );
  }
  const range = z.object({ startIndex: z.number().int(), endIndex: z.number().int() });
  switch (kind) {
    case "insertText": {
      const insert = z
        .object({
          text: z.string(),
          location: z.object({ index: z.number().int() }).optional(),
          endOfSegmentLocation: z.object({}).optional(),
        })
        .parse(fields);
      body.insert(insert.text, insert.location?.index ?? "end", next?.());
      return {};
    }
    case "deleteContentRange": {
      const { range: r } = z.object({ range }).parse(fields);
      body.delete(r.startIndex, r.endIndex, next?.());
      return {};
    }
    case "updateTextStyle": {
      const { range: r } = z
        .object({ range, textStyle: z.object({}).loose(), fields: z.string() })
        .parse(fields);
      body.style(r.startIndex, r.endIndex, next?.());
      return {};
    }
    case "replaceAllText": {
      const replace = z
        .object({
          containsText: z.object({ text: z.string(), matchCase: z.boolean().default(false) }),
          replaceText: z.string(),
        })
        .parse(fields);
      const { text, matchCase } = replace.containsText;
      const occurrencesChanged = body.replaceAll(text, replace.replaceText, matchCase, next);
      return { replaceAllText: { occurrencesChanged } };
    }
    case "updateDocumentStyle": {
      const changed = String(fields.fields)
        .split(",")
        .map((field) => field.trim().split(".")[0]);
      if (mode === "SUGGEST" && UNSUGGESTABLE_STYLE_FIELDS.some((f) => changed.includes(f))) {
        throw new DocsRequestError(
          400,
          "Invalid requests[0].updateDocumentStyle: Not supported in suggestions mode.",
        );
      }
      throw new Error("The fake Docs doesn't model document styles");
    }
    default:
      throw new Error(`The fake Docs doesn't model ${kind} requests`);
  }
}

function record(created: string[], origins: Map<string, "api" | "person">): string {
  const id = suggestionId();
  created.push(id);
  origins.set(id, "api");
  return id;
}

function suggestionId(): string {
  return `suggest.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function revisionId(doc: Doc): string {
  return `ALm37BW${doc.id.slice(-6)}r${String(doc.revision)}`;
}

// The document ID in a Docs path, decoded: `/v1/documents/{id}` or `/v1/documents/{id}:batchUpdate`.
function documentId(path: string): string | undefined {
  const id = /^\/v1\/documents\/([^/]+)$/.exec(path)?.at(1);
  return id === undefined ? undefined : decodeURIComponent(id);
}

/** An error as Docs answers it. */
export function docsError(code: 400 | 403 | 404 | 429 | 503, status: string, message = status) {
  return HttpResponse.json({ error: { code, message, status } }, { status: code });
}
