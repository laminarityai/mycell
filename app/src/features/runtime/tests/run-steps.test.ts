import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { actionNames } from "@/features/policy/catalog";
import { stepTypes } from "@/features/spec/types";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executorCoverage } from "../coverage";
import { executeRun, getRun, startRun } from "../server";
import { connectInbox, pricingQuestion, publish, recordsOf, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

const SUBJECT = "Quote for 30 oak chairs";
const BODY = "Hello, what would 30 oak chairs cost delivered to Leeds?";

const classify = {
  id: "classify",
  type: "classify",
  role: "classify",
  question: "Is this a pricing inquiry?",
  labels: ["yes", "no"],
};

async function run(steps: unknown[]) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [
    pricingQuestion({ subject: SUBJECT, text: BODY }),
  ]);
  const message = inbox.messages[0];
  const workflowId = await publish(admin, threadSpec({ steps }));
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, message.id);
  return { admin, system, message, workflowId, runId };
}

describe("the steps", () => {
  it("escalates the run on the otherwise path of a gate that escalated", async () => {
    const { admin, system, runId } = await run([
      classify,
      {
        id: "gate",
        type: "branch",
        when: { step: "classify", label: "yes", minP: 0.8 },
        else: "escalate",
      },
      {
        id: "read",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "trigger.messageId" } },
      },
    ]);
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.2, no: 0.8 } }, { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "escalated" });
    expect((await getRun(admin, runId)).steps.map((step) => step.stepId)).toEqual([
      "classify",
      "gate",
      "gate-escalate",
    ]);
  });

  it("ends the run escalated at an escalate step", async () => {
    const { admin, system, message, runId } = await run([
      {
        id: "read",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "trigger.messageId" } },
      },
      { id: "human", type: "escalate", reason: "Every message needs a person for now." },
      {
        id: "after",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "read.messageId" } },
      },
    ]);

    expect(await executeRun(system, runId)).toEqual({ status: "escalated" });
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "read",
        output: {
          fields: {
            messageId: { kind: "text", size: message.id.length },
            threadId: { kind: "text", size: message.threadId.length },
            labelIds: { kind: "list", size: message.labelIds.length },
          },
        },
      },
      { stepId: "human", type: "escalate", status: "succeeded" },
    ]);
  });

  it("hands extracted values to later steps but records only which fields were filled", async () => {
    const { admin, system, runId } = await run([
      {
        id: "details",
        type: "extract",
        role: "fast",
        fields: {
          quantity: { type: "number", description: "How many chairs" },
          city: { type: "string", description: "Where to deliver" },
          deadline: { type: "string", description: "When they're needed by" },
        },
      },
    ]);
    fakeAiGateway.object({ quantity: 30, city: "Leeds", deadline: null }, { costUsd: 0.001 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "details",
        output: { fields: { quantity: true, city: true, deadline: false } },
        modelRole: "fast",
        modelId: "test/fast-default",
        costUsd: 0.001,
      },
    ]);
    expect(JSON.stringify(fakeAiGateway.requests("language").at(0)?.body)).toContain(BODY);
  });

  it("keeps no subject, body or extracted value in the run's records", async () => {
    const { admin, system, runId } = await run([
      classify,
      {
        id: "gate",
        type: "branch",
        when: { step: "classify", label: "yes", minP: 0.5 },
        else: "stop",
      },
      {
        id: "details",
        type: "extract",
        role: "fast",
        fields: { city: { type: "string", description: "Where to deliver" } },
      },
      {
        id: "thread",
        type: "tool",
        action: "google-mail.read-thread",
        input: { threadId: { from: "trigger.threadId" } },
      },
    ]);
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    fakeAiGateway.object({ city: "Leeds" }, { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const records = recordsOf(await getRun(admin, runId));
    for (const content of [SUBJECT, BODY, "oak chairs", "Leeds", "ada@customer.test"]) {
      expect(records).not.toContain(content);
    }
  });
});

describe("executorCoverage", () => {
  it("lists every catalog action and step type, all ready", () => {
    expect(Object.keys(executorCoverage.actions).sort()).toEqual([...actionNames].sort());
    expect(Object.keys(executorCoverage.steps).sort()).toEqual([...stepTypes].sort());
    expect(executorCoverage).toEqual({
      actions: {
        "google-mail.read-message": "ready",
        "google-mail.read-thread": "ready",
        "google-mail.add-label": "ready",
        "google-mail.create-draft": "ready",
        "google-sheet.read-range": "ready",
        "google-sheet.append-row": "ready",
        "google-calendar.read-event": "ready",
        "google-calendar.create-event": "ready",
        "memory.lookup": "ready",
      },
      steps: {
        classify: "ready",
        branch: "ready",
        extract: "ready",
        tool: "ready",
        escalate: "ready",
        draft: "ready",
        approval: "ready",
      },
    });
  });
});
