// The action catalog, as code (invariant 4): every catalog action's risk level is fixed here
// by our team, and nothing a spec or a model says changes it. v1 has six Gmail and Sheets
// actions; no action is `financial` or `destructive`. Code that looks up the action a workflow
// names takes the company's action set (`action-set.ts`), which starts from this catalog.
import { z } from "zod";
import { GOOGLE_HOSTS, googleScope as scope } from "@/lib/google";
import { actionSetOf } from "./action-set";
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
 * with any one of their scopes granted, the same rule as save-time validation's scope check.
 */
export function actionsAllowedBy(grantedScopes: readonly string[]): CatalogAction[] {
  return actions.filter((action) => action.scopes.some((s) => grantedScopes.includes(s)));
}
