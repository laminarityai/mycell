// PROTOTYPE, never merge. A copy of the v1 catalog's names, words and risk levels, plus the
// fields each action declares for conditions to test (ADR-0015). The real one is
// `features/policy/catalog.ts`.
import type { FactName, RiskLevel } from "./types";

export type MockAction = {
  name: string;
  app: "Gmail" | "Sheets" | "Tasks";
  label: string;
  description: string;
  risk: RiskLevel;
  inputs: string[];
  /** Fields a condition may test on this action's result. */
  returns: { name: string; type: "string" | "number" | "boolean" }[];
};

export const ACTIONS: MockAction[] = [
  {
    name: "google-mail.read-message",
    app: "Gmail",
    label: "Read message",
    description: "Read one message's IDs and labels.",
    risk: "read",
    inputs: ["messageId"],
    returns: [{ name: "labelCount", type: "number" }],
  },
  {
    name: "google-mail.read-thread",
    app: "Gmail",
    label: "Read thread",
    description: "Read the thread a message belongs to.",
    risk: "read",
    inputs: ["threadId"],
    returns: [{ name: "messageCount", type: "number" }],
  },
  {
    name: "google-mail.add-label",
    app: "Gmail",
    label: "Add label",
    description: "Add a label to a message, creating the label if it doesn't exist.",
    risk: "internal_reversible",
    inputs: ["messageId", "label"],
    returns: [{ name: "labelId", type: "string" }],
  },
  {
    name: "google-mail.create-draft",
    app: "Gmail",
    label: "Create draft",
    description: "Write a reply to the triggering message as a draft in its thread.",
    risk: "external_send",
    inputs: ["messageId"],
    returns: [{ name: "draftId", type: "string" }],
  },
  {
    name: "google-sheet.read-range",
    app: "Sheets",
    label: "Look up in a sheet",
    description: "Read a range of cells from a spreadsheet.",
    risk: "read",
    inputs: ["spreadsheetId", "range"],
    returns: [
      { name: "rowCount", type: "number" },
      { name: "columnCount", type: "number" },
    ],
  },
  {
    name: "google-sheet.append-row",
    app: "Sheets",
    label: "Append a row",
    description: "Add a row after the last row of a range's table.",
    risk: "internal_reversible",
    inputs: ["spreadsheetId", "range", "values"],
    returns: [{ name: "updatedRange", type: "string" }],
  },
  {
    // Not in the v1 catalog: M11 brings Tasks. Here so the every-match shape can add a task.
    name: "google-tasks.create-task",
    app: "Tasks",
    label: "Add a task",
    description: "Add a task to a Google Tasks list.",
    risk: "internal_reversible",
    inputs: ["list", "title"],
    returns: [{ name: "taskId", type: "string" }],
  },
];

export function findAction(name: string): MockAction | undefined {
  return ACTIONS.find((action) => action.name === name);
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  read: "Read",
  internal_reversible: "Internal, reversible",
  external_send: "External send",
  financial: "Financial",
  destructive: "Destructive",
};

/** Facts the Gmail trigger declares about the message. */
export const FACTS: Record<FactName, string> = {
  sender_domain: "sender's domain",
  subject: "subject",
  has_attachment: "has an attachment",
  is_reply: "is a reply",
};

export const ROLES = ["classify", "fast", "smart", "judge"] as const;
