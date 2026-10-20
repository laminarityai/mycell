// The action catalog, as code (invariant 4): every catalog action's risk level is fixed here
// by our team, and nothing a spec or a model says changes it. v1 has six Gmail and Sheets
// actions; no action is `financial` or `destructive`.
import { z } from "zod";
import type { CatalogAction } from "./types";

const GMAIL_HOST = "https://gmail.googleapis.com";
const SHEETS_HOST = "https://sheets.googleapis.com";

const scope = (name: string) => `https://www.googleapis.com/auth/${name}`;
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
    name: "google-mail.read-message",
    risk: "read",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_READ,
    input: z.object({ messageId: id }),
    output: z.object({ messageId: id, threadId: id, labelIds: z.array(z.string()) }),
  },
  {
    name: "google-mail.read-thread",
    risk: "read",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_READ,
    input: z.object({ threadId: id }),
    output: z.object({ threadId: id, messageCount: z.number().int().nonnegative() }),
  },
  {
    name: "google-mail.add-label",
    risk: "internal_reversible",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_MODIFY,
    input: z.object({ messageId: id, label: z.string().min(1) }),
    output: z.object({ messageId: id, labelId: id }),
  },
  {
    name: "google-mail.create-draft",
    risk: "external_send",
    integration: "google",
    host: GMAIL_HOST,
    scopes: GMAIL_COMPOSE,
    // A reply to the triggering message, in its thread; the body is generated in the step.
    input: z.object({ messageId: id }),
    output: z.object({ draftId: id, threadId: id }),
  },
  {
    name: "google-sheet.read-range",
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
  },
  {
    name: "google-sheet.append-row",
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

/** The catalog action with this name, or undefined when there is none. */
export function findAction(name: string): CatalogAction | undefined {
  return (catalog as Readonly<Record<string, CatalogAction>>)[name];
}
