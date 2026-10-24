// The action catalog, as code (invariant 4): every catalog action's risk level is fixed here
// by our team, and nothing a spec or a model says changes it. v1 has six Gmail and Sheets
// actions, two Docs actions (`docs-actions.ts`), two Calendar actions (`calendar-actions.ts`),
// three Tasks actions and one that reads memory; no action is `financial` or `destructive`. Code
// that looks up the action a workflow names takes the company's action set (`action-set.ts`),
// which starts from this catalog.
import { z } from "zod";
import { GOOGLE_HOSTS, googleScope as scope } from "@/lib/google";
import { actionSetOf, scopesOf } from "./action-set";
import { calendarActions } from "./calendar-actions";
import { docsActions } from "./docs-actions";
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
const TASKS_HOST = GOOGLE_HOSTS.tasks;
const TASKS_READ = [scope("tasks"), scope("tasks.readonly")];
const TASKS_WRITE = [scope("tasks")];

const id = z.string().min(1);
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
// An A1 range naming its sheet, so a write's marker search covers the whole sheet it writes to.
const sheetRange = z.string().regex(/^.+![^!]+$/, "Name the sheet in the range, as in Sheet1!A:C.");
// Tasks keeps a due date's date and drops its time of day, so a due date is a date only.
const dueDate = z.iso.date("Give the due date as a date, YYYY-MM-DD: Tasks keeps no time of day.");
const taskTitle = z.string().trim().min(1).max(1000);
// Google allows 8,192 characters of notes, and Mycel adds a line naming the workflow.
const taskNotes = z.string().max(7000);

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
  ...docsActions,
  ...calendarActions,
  {
    kind: "catalog",
    name: "google-tasks.list-tasks",
    app: "Tasks",
    description:
      "List the open tasks on the person's default Tasks list: each one's ID, title, notes and " +
      "due date. Tasks assigned to them from Docs or Chat are left out.",
    risk: "read",
    integration: "google",
    host: TASKS_HOST,
    scopes: TASKS_READ,
    input: z.object({}),
    // Titles and notes pass to later steps, never into run records (ADR-0021).
    output: z.object({
      taskCount: z.number().int().nonnegative(),
      tasks: z.array(
        z.object({
          id,
          title: z.string(),
          notes: z.string().optional(),
          due: z.string().optional(),
        }),
      ),
    }),
    conditionFields: [{ name: "taskCount", type: "number", label: "The number of open tasks" }],
  },
  {
    kind: "catalog",
    name: "google-tasks.create-task",
    app: "Tasks",
    description:
      "Add a task to the person's default Tasks list, its notes ending with the workflow that " +
      "added it. A due date is a date only.",
    risk: "internal_reversible",
    integration: "google",
    host: TASKS_HOST,
    scopes: TASKS_WRITE,
    input: z.object({ title: taskTitle, notes: taskNotes.optional(), due: dueDate.optional() }),
    output: z.object({ taskId: id }),
  },
  {
    kind: "catalog",
    name: "google-tasks.update-task",
    app: "Tasks",
    description:
      "Change a task on the person's default Tasks list: its title, notes, due date (a date " +
      "only) or whether it's done. A task assigned to them from Docs or Chat is refused.",
    risk: "internal_reversible",
    integration: "google",
    host: TASKS_HOST,
    scopes: TASKS_WRITE,
    input: z
      .object({
        taskId: id,
        title: taskTitle.optional(),
        notes: taskNotes.optional(),
        due: dueDate.optional(),
        done: z.boolean().optional(),
      })
      .refine(
        (input) => [input.title, input.notes, input.due, input.done].some((v) => v !== undefined),
        { message: "Change at least one of title, notes, due or done." },
      ),
    output: z.object({ taskId: id }),
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
