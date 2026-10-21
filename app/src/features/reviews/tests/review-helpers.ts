// What the reviews tests share: a run of the example spec that leaves a Gmail draft waiting for
// its review, and a member's review seeded on the member's own mailbox.
import { randomUUID } from "node:crypto";
import { seedTwoOrgs, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { executeRun, startRun } from "@/features/runtime/server";
import type { RunStep } from "@/features/runtime/types";
import { createTag } from "@/features/tags/server";
import { getWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectGoogle, connectMailbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { createReview } from "../server";

export const SUBJECT = "Quote for 30 oak chairs";
export const QUESTION = "Hello, what would 30 oak chairs cost delivered to Leeds?";
export const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered in 5 days.";

/** An inbound pricing question, a minute old, with `overrides`. */
export function pricingQuestion(overrides: Partial<FakeMessageInput> = {}): FakeMessageInput {
  return {
    from: "Ada Lovelace <ada@customer.test>",
    subject: SUBJECT,
    text: QUESTION,
    at: new Date(Date.now() - 60 * 1000),
    ...overrides,
  };
}

/** The example spec from docs/architecture.md: classify, gate, read prices, draft, approve. */
export function exampleSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-inquiry-replies",
    visibility: { tags: ["sales"] },
    credentials: "member",
    budget: { monthlyCredits: 500 },
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "classify",
        type: "classify",
        role: "classify",
        question: "Is this a pricing inquiry?",
        labels: ["yes", "no"],
      },
      {
        id: "gate",
        type: "branch",
        when: { step: "classify", label: "yes", minP: 0.85 },
        else: "stop",
      },
      {
        id: "prices",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
      },
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message", "prices"],
        output: "google-mail.create-draft",
      },
      { id: "approve", type: "approval", channel: "gmail_drafts" },
    ],
    autonomy: { rung: 3 },
  };
}

/** Saves and publishes `spec` as the admin; returns the workflow and its version's IDs. */
export async function publish(admin: Ctx, spec: Record<string, unknown>, name = "Pricing replies") {
  const { id } = await saveWorkflow(admin, { name, spec });
  await publishWorkflow(admin, id);
  const latest = (await getWorkflow(admin, id)).versions.at(0);
  if (latest === undefined) throw new Error("not published");
  return { workflowId: id, versionId: latest.id };
}

/**
 * Org A's admin runs the example spec on a pricing question in their own Google account, which
 * leaves one draft waiting. `runStep` stands in for Inngest's step runner.
 */
export async function exampleRun(
  options: { runStep?: RunStep; message?: FakeMessageInput; reply?: string } = {},
) {
  const { runStep, message = pricingQuestion(), reply = REPLY } = options;
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  await createTag(admin, "sales");
  const google = await connectGoogle(admin, orgA.admin.email);
  const seeded = google.mailbox.add(message);
  google.sheets.add("sheet-1", "Prices", [
    ["Item", "Price", "Lead time"],
    ["Oak chair", 80, "5 days"],
  ]);
  const { workflowId } = await publish(admin, exampleSpec());
  const { runId } = await startRun(admin, workflowId, google.id, seeded.id);
  fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.95, no: 0.05 } });
  fakeAiGateway.text(reply);
  const outcome = await executeRun(system, runId, runStep);
  return { orgs, admin, system, google, message: seeded, workflowId, runId, outcome };
}

/**
 * A review waiting on a member's own mailbox (org A's, unless `org` says otherwise): a pricing
 * question with a draft reply in its thread, as a run of the member's enablement would leave it.
 */
export async function memberReview(
  orgs: TwoOrgs,
  options: { org?: keyof TwoOrgs; text?: string; draft?: string } = {},
) {
  const org = orgs[options.org ?? "orgA"];
  await connectMailbox(org.admin.ctx, org.admin.email);
  const { workflowId, versionId } = await publish(org.admin.ctx, replySpec());
  return reviewOn(org.member.ctx, org.member.email, systemCtx(org.id), {
    workflowId,
    versionId,
    ...options,
  });
}

/**
 * Connects `email`'s Google account as `owner`'s member connection, seeds a question and a
 * draft reply in its thread, and records the review a run would.
 */
export async function reviewOn(
  owner: Ctx,
  email: string,
  system: Ctx,
  options: { workflowId: string; versionId: string; text?: string; draft?: string },
) {
  const google = await connectMailbox(owner, email, [
    pricingQuestion(options.text === undefined ? {} : { text: options.text }),
  ]);
  const message = google.mailbox.list(new URLSearchParams()).messages?.at(0);
  if (message === undefined) throw new Error("no message");
  const draft = google.mailbox.addDraft(message.threadId, {
    headers: { to: "Ada Lovelace <ada@customer.test>", subject: `Re: ${SUBJECT}` },
    text: options.draft ?? REPLY,
  });
  if (draft === undefined) throw new Error("no draft");
  await createReview(system, {
    runId: randomUUID(),
    connectionId: google.id,
    workflowId: options.workflowId,
    workflowVersionId: options.versionId,
    kind: "approval",
    itemRef: draft.id,
    threadRef: message.threadId,
    sourceRef: message.id,
  });
  return { google, mailbox: google.mailbox, message, draft };
}

/** A member-credential spec that drafts a reply and waits for its review. */
export function replySpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-replies",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      },
      { id: "approve", type: "approval", channel: "gmail_drafts" },
    ],
    autonomy: { rung: 3 },
  };
}

/** A step runner that runs the approval step's body twice, as an Inngest retry would. */
export const approvalRetried: RunStep = async (id, run) => {
  if (id === "approve") await run();
  return run();
};
