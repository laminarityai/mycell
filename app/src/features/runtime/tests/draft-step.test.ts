import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { spendingKindOf } from "@/features/credits/types";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, getRun, startRun } from "../server";
import {
  connectInbox,
  pricingQuestion,
  publish,
  recordedBackoff,
  recordingStepRunner,
} from "./run-helpers";

beforeEach(resetDatabase);

const SUBJECT = "Quote for 30 oak chairs";
const BODY = "Hello, what would 30 oak chairs cost delivered to Leeds?";
const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered to Leeds next week.";

/** The architecture's example spec, without its sheet step. */
function replySpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-replies",
    credentials: "member",
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
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message", "classify"],
        output: "google-mail.create-draft",
      },
      { id: "approve", type: "approval", channel: "gmail_drafts" },
    ],
    autonomy: { rung: 3 },
  };
}

async function replyRun(spec = replySpec()) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [
    pricingQuestion({ from: "Ada Lovelace <ada@customer.test>", subject: SUBJECT, text: BODY }),
  ]);
  const message = inbox.messages[0];
  const workflowId = await publish(admin, spec);
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, message.id);
  fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.95, no: 0.05 } }, { costUsd: 0 });
  return { admin, system, mailbox: inbox.mailbox, message, workflowId, runId };
}

function header(
  message: { payload: { headers: { name: string; value: string }[] } },
  name: string,
) {
  return message.payload.headers.find((h) => h.name === name)?.value;
}

describe("the draft step", () => {
  it("leaves one draft replying to the sender in the message's thread, and records its ID", async () => {
    const { admin, system, mailbox, message, runId } = await replyRun();
    fakeAiGateway.text(REPLY, { costUsd: 0.003 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const drafts = mailbox.drafts();
    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft).toMatchObject({
      threadId: message.threadId,
      text: REPLY,
      headers: {
        to: "Ada Lovelace <ada@customer.test>",
        subject: `Re: ${SUBJECT}`,
        "in-reply-to": header(message, "Message-ID"),
        references: header(message, "Message-ID"),
      },
    });
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "classify" },
      { stepId: "gate" },
      {
        stepId: "draft",
        status: "succeeded",
        output: { draftId: draft.id, threadId: message.threadId },
        modelRole: "smart",
        modelId: "test/smart-default",
        costUsd: 0.003,
      },
      {
        stepId: "approve",
        status: "succeeded",
        output: { awaiting: "human", channel: "gmail_drafts", draftIds: [draft.id] },
      },
    ]);
  });

  it("charges its model calls to its workflow's run", async () => {
    const { admin, system, workflowId, runId } = await replyRun();
    fakeAiGateway.text(REPLY, { costUsd: 0.003 });

    await executeRun(system, runId);

    const usage = (await listLedger(admin)).filter((entry) => entry.kind === "usage");
    expect(usage.map((entry) => entry.role).sort()).toEqual(["classify", "smart"]);
    for (const entry of usage) {
      expect(entry).toMatchObject({ workflowId, runId, dryRun: false, purpose: null });
      expect(spendingKindOf(entry)).toBe("workflow");
    }
  });

  it("writes from the step's instructions, the message and the earlier steps it names", async () => {
    const { system, runId } = await replyRun();
    fakeAiGateway.text(REPLY);

    await executeRun(system, runId);

    const request = JSON.stringify(fakeAiGateway.requests("language").at(0)?.body);
    for (const part of ["Reply with our current prices.", BODY, SUBJECT, '\\"label\\":\\"yes\\"']) {
      expect(request).toContain(part);
    }
  });

  it("replies to Reply-To over From, and keeps the thread's References", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const system = systemCtx(orgA.id);
    await grantCredits(system, 100);
    const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
    const original = inbox.messages[0];
    const reply = inbox.mailbox.add(
      pricingQuestion({
        subject: "Re: Quote for 30 oak chairs",
        threadId: original.threadId,
        headers: {
          "Reply-To": "orders@customer.test",
          References: `<root@customer.test> ${String(header(original, "Message-ID"))}`,
        },
      }),
    );
    const workflowId = await publish(admin, replySpec());
    const { runId } = await startRun(admin, workflowId, inbox.connectionId, reply.id);
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.95, no: 0.05 } });
    fakeAiGateway.text(REPLY);

    await executeRun(system, runId);

    expect(inbox.mailbox.drafts()[0]?.headers).toMatchObject({
      to: "orders@customer.test",
      subject: "Re: Quote for 30 oak chairs",
      references: `<root@customer.test> ${String(header(original, "Message-ID"))} ${String(header(reply, "Message-ID"))}`,
    });
  });

  it("leaves one draft when its first try made the draft but lost Gmail's answer", async () => {
    const { admin, system, mailbox, runId } = await replyRun();
    // Only one text is scripted: a second generation would fail the test.
    fakeAiGateway.text(REPLY);
    mailbox.writes.loseNextAnswer();

    expect(await executeRun(system, runId, undefined, recordedBackoff())).toEqual({
      status: "succeeded",
    });

    expect(mailbox.drafts()).toHaveLength(1);
    expect(mailbox.writes.log).toEqual(["drafts.create"]);
    const steps = (await getRun(admin, runId)).steps;
    expect(steps.find((step) => step.stepId === "draft")).toMatchObject({
      attempts: 2,
      output: { draftId: mailbox.drafts()[0]?.id },
    });
  });

  it("records at each approval every draft above it, as a v1 workflow did", async () => {
    const spec = replySpec();
    const steps = spec.steps as Record<string, unknown>[];
    steps.push(
      { ...steps[2], id: "follow-up", instructions: "Offer a call." },
      { id: "approve-again", type: "approval", channel: "gmail_drafts" },
    );
    const { admin, system, mailbox, runId } = await replyRun(spec);
    fakeAiGateway.text(REPLY, { costUsd: 0 });
    fakeAiGateway.text("Happy to talk it over on a call.", { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const [first, second] = mailbox.drafts().map((draft) => draft.id);
    const approvals = (await getRun(admin, runId)).steps.filter((step) => step.type === "approval");
    expect(approvals.map((step) => [step.stepId, step.output])).toEqual([
      ["approve", { awaiting: "human", channel: "gmail_drafts", draftIds: [first] }],
      ["approve-again", { awaiting: "human", channel: "gmail_drafts", draftIds: [first, second] }],
    ]);
  });

  it("keeps the draft's text, the subject and the body out of the run's records and step state", async () => {
    const { admin, system, runId } = await replyRun();
    fakeAiGateway.text(REPLY);
    const runner = recordingStepRunner();

    await executeRun(system, runId, runner.runStep);

    const kept = JSON.stringify([await getRun(admin, runId), runner.results()]);
    for (const content of [REPLY, "2,400", SUBJECT, BODY, "ada@customer.test"]) {
      expect(kept).not.toContain(content);
    }
  });
});
