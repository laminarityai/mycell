// Held sends through the real paths, for any feature's tests (ADR-0020): a published workflow
// reads the triggering Gmail message and replies to an Outlook message with its body through a
// custom write, so each run leaves the reply held, waiting for its review.
import { grantCredits } from "@/features/credits/server";
import { listReviews } from "@/features/reviews/server";
import { executeRun, startRun, startTriggeredRuns } from "@/features/runtime/server";
import type { RunStep } from "@/lib/inngest";
import { enable } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectApp, connectGoogle } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { replyToOutlookMessage, storeCustomAction } from "./custom-actions";
import type { TwoOrgs } from "./two-org-fixture";

export const OUTLOOK_MESSAGE = "AAMkAGI2-outlook-1";
export const REPLY_TEXT = "Thanks Ada, 30 oak chairs come to 2,400 GBP.";

/**
 * Reads the triggering message, then replies to the Outlook message with its body: the reply is
 * a custom write, so the policy engine inserts its `held_send` approval (`reply-approval`).
 */
export function heldReplySpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 2,
    id: "outlook-replies",
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
        id: "reply",
        type: "tool",
        action: "microsoft.reply-to-message",
        input: { messageId: OUTLOOK_MESSAGE, comment: { from: "read.body" } },
      },
    ],
    ...overrides,
  };
}

export type HeldSendOptions = {
  /** Whose run it is: the admin's own, a member's enablement, or an org connection's. */
  owner?: "admin" | "member" | "org";
  /** The triggering message's body, which becomes the reply's comment. */
  text?: string;
  /** The workflow's hand-off setting. */
  handoff?: boolean;
  runStep?: RunStep;
};

/**
 * Org A's admin stores the custom write and publishes the reply workflow to `sales`, which org
 * A's member has; then `owner`'s run of it on a new message leaves its reply held. Returns the
 * run, its review, and the fake Microsoft 365 account the reply would go to.
 */
export async function heldSend(orgs: TwoOrgs, options: HeldSendOptions = {}) {
  const { orgA } = orgs;
  const owner = options.owner ?? "admin";
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const kind = owner === "org" ? "org" : "member";
  const adminAccount = owner === "org" ? `support@${orgA.workspaceDomain}` : orgA.admin.email;
  const adminApps = await connectApps(admin, adminAccount, kind);
  await storeCustomAction(admin, replyToOutlookMessage());
  await tagUsers(admin, "sales", [orgA.member]);
  const spec = heldReplySpec({
    credentials: kind,
    ...(options.handoff === undefined ? {} : { review: { handoff: options.handoff } }),
  });
  const { workflowId } = await publishTo(admin, "Outlook replies", spec, ["sales"]);
  const runner: Ctx = owner === "member" ? orgA.member.ctx : admin;
  const apps =
    owner === "member" ? await connectApps(runner, orgA.member.email, "member") : adminApps;
  const message = apps.google.mailbox.add({
    from: "Ada Lovelace <ada@customer.test>",
    subject: "Quote for 30 oak chairs",
    text: options.text ?? REPLY_TEXT,
    at: new Date(Date.now() - 60 * 1000),
  });
  let runId: string;
  if (owner === "member") {
    await enable(runner, workflowId);
    const started = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: apps.google.id,
      sourceRef: message.id,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    runId = started.runIds[0];
  } else {
    runId = (await startRun(admin, workflowId, apps.google.id, message.id)).runId;
  }
  const outcome = await executeRun(system, runId, options.runStep);
  const reviewId = (await listReviews(runner)).at(0)?.id ?? "";
  return { owner: runner, admin, system, workflowId, runId, outcome, reviewId, message, ...apps };
}

// The account's Google connection and its Microsoft 365 connection (Mycel's ID and Nango's), with
// the Outlook message the reply goes to.
async function connectApps(ctx: Ctx, email: string, kind: "member" | "org") {
  const google = await connectGoogle(ctx, email, { kind });
  const microsoft = await connectApp(ctx, "microsoft", email, { kind });
  const outlook = fakeNango.microsoft(microsoft.connectionId);
  outlook.addMessage({
    id: OUTLOOK_MESSAGE,
    subject: "Quote for 30 oak chairs",
    from: "ada@customer.test",
    body: "Could you send a quote?",
  });
  return {
    google,
    microsoftId: microsoft.id ?? "",
    microsoftNangoId: microsoft.connectionId,
    outlook,
  };
}
