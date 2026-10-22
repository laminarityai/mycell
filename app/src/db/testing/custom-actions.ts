// Custom actions as the builder chat would describe them (ADR-0018), shared by every feature's
// tests, and a way to store one as an admin accepting it would.
import { checkCustomAction } from "@/features/custom-actions/description";
import { storeCustomActions } from "@/features/custom-actions/server";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import type { Ctx } from "@/lib/ctx";

/** Reads one message from the signed-in person's Outlook mailbox through Microsoft Graph. */
export function readOutlookMessage(overrides: Record<string, unknown> = {}) {
  return {
    name: "microsoft.read-message",
    app: "microsoft",
    description: "Read one Outlook message: its subject, sender and whether it was read.",
    call: {
      method: "GET",
      path: "/v1.0/me/messages/{messageId}",
      query: { $select: "fields" },
    },
    inputs: {
      messageId: { type: "text", description: "The Outlook message's ID." },
      fields: { type: "text", description: "Which fields Graph returns.", optional: true },
    },
    outputs: {
      subject: { type: "text", label: "The message's subject", path: "subject" },
      sender: { type: "text", label: "The sender's address", path: "from.emailAddress.address" },
      isRead: { type: "yes_no", label: "Whether it was read", path: "isRead" },
    },
    ...overrides,
  };
}

export const REPLY_PATH = "/v1.0/me/messages/{messageId}/reply";

/**
 * Replies to one Outlook message through Microsoft Graph: a write, so it waits for a person,
 * who may edit its comment first.
 */
export function replyToOutlookMessage(overrides: Record<string, unknown> = {}) {
  return {
    name: "microsoft.reply-to-message",
    app: "microsoft",
    description: "Reply to one Outlook message with a comment.",
    call: { method: "POST", path: REPLY_PATH, body: { comment: "comment" } },
    inputs: {
      messageId: { type: "text", description: "The Outlook message's ID." },
      comment: { type: "text", description: "The reply's text." },
    },
    outputs: {},
    editable: ["comment"],
    ...overrides,
  };
}

/** The description, checked: what a proposal carries and storing takes. */
export function checkedCustomAction(description: unknown): CustomActionRecord {
  const check = checkCustomAction(description);
  if (!check.ok) throw new Error(`Not a valid custom action: ${check.issues.join(" ")}`);
  return check.action;
}

/** Stores the custom action as the admin accepting it would, outside any proposal. */
export async function storeCustomAction(
  admin: Ctx,
  description: unknown = readOutlookMessage(),
): Promise<CustomActionRecord> {
  const record = checkedCustomAction(description);
  await storeCustomActions(admin, [record], {});
  return record;
}
