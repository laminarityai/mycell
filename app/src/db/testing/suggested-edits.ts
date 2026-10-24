// Suggested edits through the real paths, for any feature's tests (ADR-0017): a published
// workflow reads the triggering message and suggests edits to a weekly status doc, filling its
// status line and adding the message's subject at the end, so each run leaves the edits waiting
// in the doc as suggestions, with their review.
import { grantCredits } from "@/features/credits/server";
import { listReviews } from "@/features/reviews/server";
import { executeRun, startRun, startTriggeredRuns } from "@/features/runtime/server";
import type { RetryPolicy } from "@/features/runtime/types";
import { enable } from "@/features/workflows/server";
import type { RunStep } from "@/lib/inngest";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import type { DocAccess } from "@/testing/fake-docs";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import type { TwoOrgs } from "./two-org-fixture";

export const STATUS_DOC = "Weekly status\nProgress: {{status}}\nNotes:\n";
export const STATUS_LINE = "On track for the November launch.";
export const SUBJECT = "Kiln supplier confirmed for Friday";
/** The person's own suggestion in the doc, made in Docs before the run. */
export const OWN_SUGGESTION = " Ask Grace about the budget.";

/**
 * Reads the triggering message, then suggests two edits to the doc: the status line filled in,
 * and the message's subject added at the end. The policy engine inserts its `suggested_edits`
 * approval (`suggest-approval`).
 */
export function statusSpec(documentId: string, overrides: Record<string, unknown> = {}) {
  return {
    specVersion: 2,
    id: "weekly-status",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    autonomy: { rung: 3 },
    steps: [
      {
        id: "read",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "trigger.messageId" } },
      },
      {
        id: "suggest",
        type: "tool",
        action: "google-docs.suggest-edits",
        input: {
          documentId,
          requests: [
            {
              replaceAllText: {
                containsText: { text: "{{status}}", matchCase: true },
                replaceText: STATUS_LINE,
              },
            },
            { insertText: { text: { from: "read.subject" }, endOfSegmentLocation: {} } },
          ],
        },
      },
    ],
    ...overrides,
  };
}

export type SuggestedEditsOptions = {
  /** Whose run it is: the admin's own, or a member's enablement. */
  owner?: "admin" | "member";
  /** The account's access to the doc. */
  access?: DocAccess;
  /** The workflow's hand-off setting. */
  handoff?: boolean;
  /** Before the run, what the fake Docs is told to do with the step's write. */
  docs?: "lose_answer" | "fail_save";
  runStep?: RunStep;
  retry?: RetryPolicy;
};

/**
 * Org A's admin publishes the status workflow to `sales`, which org A's member has; then
 * `owner`'s run of it on a new message leaves its edits suggested in the doc, beside the
 * person's own suggestion. Returns the run, its review, the fake Docs and the doc's ID.
 */
export async function suggestedEdits(orgs: TwoOrgs, options: SuggestedEditsOptions = {}) {
  const { orgA } = orgs;
  const owner = options.owner ?? "admin";
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const runner: Ctx = owner === "member" ? orgA.member.ctx : admin;
  const adminGoogle = await connectGoogle(admin, orgA.admin.email);
  const google = owner === "member" ? await connectGoogle(runner, orgA.member.email) : adminGoogle;
  const documentId = google.docs.add({
    title: "Weekly status",
    text: STATUS_DOC,
    access: options.access ?? "edit",
  });
  const ownSuggestion = google.docs.suggestInDocs(documentId, OWN_SUGGESTION);
  await tagUsers(admin, "sales", [orgA.member]);
  const handoff = options.handoff === undefined ? {} : { review: { handoff: options.handoff } };
  const spec = statusSpec(documentId, handoff);
  const { workflowId } = await publishTo(admin, "Weekly status", spec, ["sales"]);
  const message = google.mailbox.add({
    from: "Ada Lovelace <ada@supplier.test>",
    subject: SUBJECT,
    text: "We can deliver the kiln on Friday.",
    at: new Date(Date.now() - 60 * 1000),
  });
  let runId: string;
  if (owner === "member") {
    await enable(runner, workflowId);
    const started = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: google.id,
      sourceRef: message.id,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    runId = started.runIds[0];
  } else {
    runId = (await startRun(admin, workflowId, google.id, message.id)).runId;
  }
  if (options.docs === "lose_answer") google.docs.loseNextAnswer();
  if (options.docs === "fail_save") google.docs.failNextSuggestionSave();
  const outcome = await executeRun(system, runId, options.runStep, options.retry);
  const reviewId = (await listReviews(runner)).at(0)?.id ?? "";
  return {
    owner: runner,
    admin,
    system,
    workflowId,
    runId,
    outcome,
    reviewId,
    google,
    docs: google.docs,
    documentId,
    ownSuggestion,
  };
}
