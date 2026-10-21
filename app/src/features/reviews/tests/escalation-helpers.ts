// What the escalation tests share: a run that hands a refund question to a person, which leaves
// an escalation review waiting on the Reviews page.
import { randomUUID } from "node:crypto";
import { seedTwoOrgs, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { executeRun, startRun } from "@/features/runtime/server";
import type { RunStep } from "@/features/runtime/types";
import { systemCtx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { createReview, listReviews } from "../server";
import { publish } from "./review-helpers";

export const REFUND_SUBJECT = "The chairs arrived scratched";
export const REFUND_QUESTION = "Two of the oak chairs arrived scratched. Can you sort this out?";
export const NOT_SURE = "Not sure this is a refund request.";

/** An inbound message that may or may not be a refund request, ten minutes old. */
export function refundQuestion(overrides: Partial<FakeMessageInput> = {}): FakeMessageInput {
  return {
    from: "Ada Lovelace <ada@customer.test>",
    subject: REFUND_SUBJECT,
    text: REFUND_QUESTION,
    at: new Date(Date.now() - 10 * 60 * 1000),
    ...overrides,
  };
}

/** A gate that hands a message to a person when it isn't sure it's a refund request. */
export function gateSpec(): Record<string, unknown> {
  return refundSpec([
    {
      id: "classify",
      type: "classify",
      role: "classify",
      question: "Is this a refund request?",
      labels: ["yes", "no"],
    },
    {
      id: "gate",
      type: "branch",
      when: { step: "classify", label: "yes", minP: 0.9 },
      else: "escalate",
    },
    {
      id: "read",
      type: "tool",
      action: "google-mail.read-message",
      input: { messageId: { from: "trigger.messageId" } },
    },
  ]);
}

/** A workflow that hands every message to a person, saying why. */
export function escalateSpec(): Record<string, unknown> {
  return refundSpec([{ id: "hand-over", type: "escalate", reason: NOT_SURE }]);
}

function refundSpec(steps: unknown[]): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "refund-requests",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps,
    autonomy: { rung: 3 },
  };
}

/**
 * Org A's admin runs `spec` on a refund question in their own mailbox, in a thread that may
 * hold an `earlier` message. `sure` is how sure the classifier is that it's a refund request,
 * for a spec that classifies. `runStep` stands in for Inngest's step runner.
 */
export async function escalationRun(
  options: {
    spec?: Record<string, unknown>;
    sure?: number;
    runStep?: RunStep;
    message?: FakeMessageInput;
    earlier?: FakeMessageInput;
  } = {},
) {
  const { spec = escalateSpec(), sure, runStep, message = refundQuestion(), earlier } = options;
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const thread = earlier === undefined ? [message] : [earlier, message];
  const google = await connectMailbox(
    admin,
    orgA.admin.email,
    thread.map((m) => ({ threadId: "refund-thread", ...m })),
  );
  // The newest message: the refund question.
  const seeded = google.mailbox.list(new URLSearchParams()).messages?.at(0);
  if (seeded === undefined) throw new Error("no message");
  const { workflowId } = await publish(admin, spec, "Refund requests");
  const { runId } = await startRun(admin, workflowId, google.id, seeded.id);
  if (sure !== undefined) {
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: sure, no: 1 - sure } });
  }
  const outcome = await executeRun(system, runId, runStep);
  return {
    orgs,
    admin,
    system,
    google,
    mailbox: google.mailbox,
    message: seeded,
    workflowId,
    outcome,
  };
}

/** An escalation run's one waiting review. */
export async function waitingEscalation(options: Parameters<typeof escalationRun>[0] = {}) {
  const run = await escalationRun(options);
  const review = (await listReviews(run.admin)).at(0);
  if (review === undefined) throw new Error("no review");
  return { ...run, reviewId: review.id };
}

/**
 * An escalation waiting on a member's own mailbox (org A's, unless `org` says otherwise): a
 * refund question, recorded as a run of the member's enablement would leave it.
 */
export async function memberEscalation(orgs: TwoOrgs, org: keyof TwoOrgs = "orgA") {
  const { id, admin, member } = orgs[org];
  await connectMailbox(admin.ctx, admin.email);
  const { workflowId, versionId } = await publish(admin.ctx, escalateSpec(), "Refund requests");
  const google = await connectMailbox(member.ctx, member.email, [refundQuestion()]);
  const message = google.mailbox.list(new URLSearchParams()).messages?.at(0);
  if (message === undefined) throw new Error("no message");
  await createReview(systemCtx(id), {
    runId: randomUUID(),
    connectionId: google.id,
    workflowId,
    workflowVersionId: versionId,
    kind: "escalation",
    itemRef: message.id,
    threadRef: message.threadId,
    sourceRef: message.id,
    reason: NOT_SURE,
  });
  return { google, mailbox: google.mailbox, message };
}
