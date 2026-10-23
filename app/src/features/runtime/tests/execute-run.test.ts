import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, listRuns, startRun } from "../server";
import type { RunStep } from "@/lib/inngest";
import {
  connectInbox,
  pricingQuestion,
  publish,
  recordingStepRunner,
  threadSpec,
} from "./run-helpers";

beforeEach(resetDatabase);

async function adminRun(spec = threadSpec()) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [
    pricingQuestion({ threadId: "thread-1" }),
    pricingQuestion({ threadId: "thread-1", subject: "Re: Quote for 30 oak chairs" }),
  ]);
  const message = inbox.messages[1];
  const workflowId = await publish(admin, spec);
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, message.id);
  return { orgA, admin, system, inbox, message, workflowId, runId };
}

describe("executeRun", () => {
  it("runs classify, branch and read-thread, recording each step's derived output", async () => {
    const { admin, system, inbox, message, workflowId, runId } = await adminRun();
    fakeAiGateway.decision(
      { choice: "yes", probabilities: { yes: 0.93, no: 0.07 } },
      { costUsd: 0.0002 },
    );

    const result = await executeRun(system, runId);

    expect(result).toEqual({ status: "succeeded" });
    expect(fakeInngest.sent("runtime/run.requested")).toMatchObject([
      { id: `run-${runId}`, data: { orgId: admin.orgId, runId } },
    ]);
    const run = await getRun(admin, runId);
    expect(run).toMatchObject({
      id: runId,
      workflowId,
      connectionId: inbox.connectionId,
      ownerScope: "member",
      sourceRef: message.id,
      status: "succeeded",
      costUsd: 0.0002,
    });
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.steps).toMatchObject([
      {
        stepId: "classify",
        type: "classify",
        status: "succeeded",
        attempts: 1,
        output: { label: "yes", p: 0.93, fallback: false },
        modelRole: "classify",
        modelId: "typesafe-ai/jev-1.14.0",
        costUsd: 0.0002,
      },
      {
        stepId: "gate",
        type: "branch",
        status: "succeeded",
        output: { taken: ["gate-yes"], paths: [{ id: "gate-yes", holds: true, checks: [true] }] },
      },
      {
        stepId: "thread",
        type: "tool",
        status: "succeeded",
        // The result's fields by kind and size, never their values (ADR-0021).
        output: {
          fields: { threadId: { kind: "text", size: 8 }, messageCount: { kind: "number" } },
        },
        modelRole: null,
        costUsd: 0,
      },
    ]);
  });

  it("classifies the message's own sender, subject and text, fetched through the proxy", async () => {
    const { system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.1, no: 0.9 } }, { costUsd: 0 });

    await executeRun(system, runId);

    const state = JSON.stringify(fakeAiGateway.requests("decision").at(0)?.body);
    expect(state).toContain("ada@customer.test");
    expect(state).toContain("Re: Quote for 30 oak chairs");
    expect(state).toContain("30 oak chairs cost delivered to Leeds");
  });

  it("runs each spec step as one step under its own ID", async () => {
    const { system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const runner = recordingStepRunner();

    await executeRun(system, runId, runner.runStep);

    expect(runner.ids).toEqual(["classify", "gate", "thread"]);
  });

  it("replays finished steps after a crash, so the classify call isn't made again", async () => {
    const { admin, system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const runner = recordingStepRunner();
    runner.crashAt("thread");

    await expect(executeRun(system, runId, runner.runStep)).rejects.toThrow("crashed");
    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(fakeAiGateway.requests()).toHaveLength(1);
    expect(runner.ids).toEqual(["classify", "gate", "thread", "classify", "gate", "thread"]);
    expect((await getRun(admin, runId)).steps.map((step) => step.stepId)).toEqual([
      "classify",
      "gate",
      "thread",
    ]);
  });

  it("does nothing for a run that already finished", async () => {
    const { system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.1, no: 0.9 } }, { costUsd: 0 });
    await executeRun(system, runId);
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "skipped" });
    expect(runner.ids).toEqual([]);
  });

  it("keeps when a run finished when a retry that began before then finishes it again", async () => {
    const { admin, system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const runner = recordingStepRunner();
    let finishedFirst: Date | null = null;
    // A retry that read the run as running, then finishes after another invocation finished it.
    const retried: RunStep = async (id, run) => {
      const result = await runner.runStep(id, run);
      if (id === "thread" && finishedFirst === null) {
        await executeRun(system, runId, runner.runStep);
        finishedFirst = (await getRun(admin, runId)).finishedAt;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return result;
    };

    expect(await executeRun(system, runId, retried)).toEqual({ status: "succeeded" });

    expect(finishedFirst).not.toBeNull();
    expect((await getRun(admin, runId)).finishedAt).toEqual(finishedFirst);
  });

  it("ends cancelled when the connection is deleted mid-run, taking the run with it", async () => {
    const { admin, system, inbox, workflowId, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    fakeNango.beforeProxy(async (path) => {
      if (path.includes("/threads/")) await disconnect(admin, inbox.connectionId);
    });

    expect(await executeRun(system, runId)).toEqual({ status: "cancelled" });

    await expect(getRun(admin, runId)).rejects.toThrow(NotFoundError);
    expect((await listRuns(admin, { workflowId })).runs).toEqual([]);
  });

  it("does nothing for a run that went with its connection between steps", async () => {
    const { admin, system, inbox, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const runner = recordingStepRunner();
    runner.crashAt("gate");
    await expect(executeRun(system, runId, runner.runStep)).rejects.toThrow("crashed");
    await disconnect(admin, inbox.connectionId);

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "cancelled" });
    expect(runner.ids).toEqual(["classify", "gate"]);
  });

  it("records the run cancelled when Nango no longer has the connection", async () => {
    const { admin, system, inbox, runId } = await adminRun();
    fakeNango.deleteWithoutWebhook(inbox.nangoConnectionId);

    expect(await executeRun(system, runId)).toEqual({ status: "cancelled" });

    const run = await getRun(admin, runId);
    expect(run).toMatchObject({ status: "cancelled", steps: [] });
    expect(fakeAiGateway.requests()).toEqual([]);
  });

  it("ends the run skipped when the branch's label is below its minimum probability", async () => {
    const { admin, system, runId } = await adminRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.6, no: 0.4 } }, { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "skipped" });

    const run = await getRun(admin, runId);
    expect(run.status).toBe("skipped");
    expect(run.steps.map((step) => [step.stepId, step.output])).toEqual([
      ["classify", { label: "yes", p: 0.6, fallback: false }],
      [
        "gate",
        { taken: ["gate-otherwise"], paths: [{ id: "gate-yes", holds: false, checks: [false] }] },
      ],
    ]);
  });
});
