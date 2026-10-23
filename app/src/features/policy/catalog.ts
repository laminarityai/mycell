// The action catalog, as code (invariant 4): every catalog action's risk level is fixed here
// by our team, and nothing a spec or a model says changes it. v1 has Gmail, Sheets and Docs
// actions and one that reads memory; no action is `financial` or `destructive`. Code that looks
// up the action a workflow names takes the company's action set (`action-set.ts`), which starts
// from this catalog.
import { z } from "zod";
import { GOOGLE_HOSTS, googleScope as scope } from "@/lib/google";
import { actionSetOf, scopesOf } from "./action-set";
import { docsRequestSchema } from "./docs-requests";
import type { ActionSet, CatalogAction } from "./types";

const GMAIL_HOST = GOOGLE_HOSTS.gmail;
const SHEETS_HOST = GOOGLE_HOSTS.sheets;
const GMAIL_READ = [scope("gmail.readonly"), scope("gmail.modify")];
const GMAIL_MODIFY = [scope("gmail.modify")];
const GMAIL_COMPOSE = [scope("gmail.modify"), scope("gmail.compose")];
const SHEETS_READ = [
  scope("drive.readonly"),
  scope("drive"),
  scope("spreadsheets.readonly"),
  scope("spreadsheets"),
];
const SHEETS_WRITE = [scope("spreadsheets")];
const DOCS_HOST = GOOGLE_HOSTS.docs;
const DOCS_READ = [
  scope("documents"),
  scope("documents.readonly"),
  scope("drive"),
  scope("drive.readonly"),
];
const DOCS_WRITE = [scope("documents"), scope("drive")];

const id = z.string().min(1);
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
// An A1 range naming its sheet, so a write's marker search covers the whole sheet it writes to.
const sheetRange = z.string().regex(/^.+![^!]+$/, "Name the sheet in the range, as in Sheet1!A:C.");

const actions = [
  {
    kind: "catalog",
    name: "google-mail.read-message",
    app: "Gmail",
    description: "Read one message: its IDs, labels, sender, subject and plain-text body.",
    risk: "read",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_READ,
    input: z.object({ messageId: id }),
    // Its sender, subject and body pass to later steps, never into run records (ADR-0021).
    output: z.object({
      messageId: id,
      threadId: id,
      labelIds: z.array(z.string()),
      from: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  },
  {
    kind: "catalog",
    name: "google-mail.read-thread",
    app: "Gmail",
    description: "Read the thread a message belongs to.",
    risk: "read",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_READ,
    input: z.object({ threadId: id }),
    output: z.object({ threadId: id, messageCount: z.number().int().nonnegative() }),
    conditionFields: [
      { name: "messageCount", type: "number", label: "The number of messages in the thread" },
    ],
  },
  {
    kind: "catalog",
    name: "google-mail.add-label",
    app: "Gmail",
    description: "Add a label to a message, creating the label if it doesn't exist.",
    risk: "internal_reversible",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_MODIFY,
    input: z.object({ messageId: id, label: z.string().min(1) }),
    output: z.object({ messageId: id, labelId: id }),
  },
  {
    kind: "catalog",
    name: "google-mail.create-draft",
    app: "Gmail",
    description: "Write a reply to the triggering message as a draft in its thread.",
    pendingForm: "a Gmail draft",
    channel: "gmail_drafts",
    risk: "external_send",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_COMPOSE,
    // A reply to the triggering message, in its thread; the body is generated in the step.
    input: z.object({ messageId: id }),
    output: z.object({ draftId: id, threadId: id }),
  },
  {
    kind: "catalog",
    name: "google-sheet.read-range",
    app: "Sheets",
    description: "Read a range of cells from a spreadsheet.",
    risk: "read",
    integration: "google",
    host: SHEETS_HOST,
    scopes: SHEETS_READ,
    input: z.object({ spreadsheetId: id, range: sheetRange }),
    output: z.object({
      range: z.string(),
      rowCount: z.number().int().nonnegative(),
      columnCount: z.number().int().nonnegative(),
    }),
    // Its rows' values stay out of the output (ADR-0012), so a check can test whether the
    // lookup found rows, never what they hold.
    conditionFields: [{ name: "rowCount", type: "number", label: "The number of rows read" }],
  },
  {
    kind: "catalog",
    name: "google-sheet.append-row",
    app: "Sheets",
    description: "Add a row after the last row of a range's table.",
    risk: "internal_reversible",
    integration: "google",
    host: SHEETS_HOST,
    scopes: SHEETS_WRITE,
    input: z.object({ spreadsheetId: id, range: sheetRange, values: z.array(cell).min(1) }),
    output: z.object({ updatedRange: z.string() }),
  },
  {
    kind: "catalog",
    name: "google-docs.read-document",
    app: "Docs",
    description: "Read one Google Doc: its title and its text, without any suggested edits.",
    risk: "read",
    integration: "google",
    host: DOCS_HOST,
    scopes: DOCS_READ,
    input: z.object({ documentId: id }),
    // Its title and text pass to later steps, never into run records (ADR-0021).
    output: z.object({ documentId: id, title: z.string(), text: z.string() }),
  },
  {
    kind: "catalog",
    name: "google-docs.suggest-edits",
    app: "Docs",
    description:
      "Suggest edits to a Google Doc, as a person in suggesting mode would: `requests` are " +
      "Docs batchUpdate requests (such as insertText at endOfSegmentLocation, or " +
      "replaceAllText), and nothing in the doc changes until a person approves them (accepting " +
      "the suggestions) or declines them (rejecting them).",
    pendingForm: "suggested edits in the doc, accepted or rejected from the review",
    channel: "suggested_edits",
    risk: "external_send",
    integration: "google",
    host: DOCS_HOST,
    scopes: DOCS_WRITE,
    input: z.object({ documentId: id, requests: z.array(docsRequestSchema).min(1).max(100) }),
    // Pointers only: the suggested text stays in the doc.
    output: z.object({ documentId: id, suggestionIds: z.array(id) }),
  },
  {
    kind: "catalog",
    name: "memory.lookup",
    app: "Memory",
    description:
      "Look up what the company's memory knows about the message's sender, the sender's " +
      "company, or a topic: short facts, in the view of whoever the run acts for (the enabling " +
      "member on member credentials; company-wide facts only on org credentials).",
    risk: "read",
    integration: "mycel",
    input: z
      .object({
        about: z.enum(["sender", "sender_company", "topic"]),
        // The words to look up, for `about: "topic"` only.
        topic: z.string().trim().min(1).max(500).optional(),
      })
      .refine((input) => (input.about === "topic") === (input.topic !== undefined), {
        message: 'Give a topic exactly when about is "topic".',
        path: ["topic"],
      }),
    // The facts found, best match first, each with what it's about, and `disputed` when only
    // someone outside the company states it, against a fact from inside. A draft step that
    // names this step in its context reads them.
    output: z.object({
      factCount: z.number().int().nonnegative(),
      facts: z.array(
        z.object({
          id,
          about: z.string(),
          statement: z.string(),
          disputed: z.boolean().optional(),
        }),
      ),
    }),
    conditionFields: [{ name: "factCount", type: "number", label: "The number of facts found" }],
  },
] as const satisfies readonly CatalogAction[];

export type ActionName = (typeof actions)[number]["name"];

/** Every catalog action, by name. */
export const catalog: Readonly<Record<ActionName, CatalogAction>> = byName();

function byName() {
  const byName = {} as Record<ActionName, CatalogAction>;
  for (const action of actions) byName[action.name] = action;
  return byName;
}

export const actionNames = actions.map((action) => action.name);

/** The catalog alone, as an action set: what every company's action set starts from. */
export const catalogActionSet: ActionSet = actionSetOf(actions);

/**
 * The catalog actions a connection granted `grantedScopes` may run, in catalog order: those
 * that need no scope, and those with any one of their scopes granted, the same rule as
 * save-time validation's scope check.
 */
export function actionsAllowedBy(grantedScopes: readonly string[]): CatalogAction[] {
  return actions.filter((action) =>
    scopesOf(action).every((anyOf) => anyOf.some((s) => grantedScopes.includes(s))),
  );
}
