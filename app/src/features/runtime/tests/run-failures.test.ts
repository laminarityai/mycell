import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, startRun } from "../server";
import {
  connectInbox,
  pricingQuestion,
  publish,
  recordedBackoff,
  recordingStepRunner,
  threadSpec,
} from "./run-helpers";

beforeEach(resetDatabase);

// Nango retries a 429 three times itself, so each failed attempt uses up four.
const NANGO_TRIES = 4;

async function adminRun(spec = threadSpec(), credits = 100) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  if (credits > 0) await grantCredits(system, credits);
  const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
  const message = inbox.messages[0];
  const workflowId = await publish(admin, spec);
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, message.id);
  return { admin, system, runId };
}

const confident = () => {
  fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
};

describe("a failing step", () => {
  it("is tried again after a backoff, and records how many attempts it took", async () => {
    const { admin, system, runId } = await adminRun();
    confident();
    const backoff = recordedBackoff();
    // classify reads the message first; then the thread read meets the rate limit once.
    fakeNango.beforeProxy((path) => {
      if (path.includes("/threads/") && fakeNango.rateLimitsAnswered() === 0) {
        fakeNango.rateLimitSource(NANGO_TRIES);
      }
    });

    expect(await executeRun(system, runId, undefined, backoff.sleep)).toEqual({
      status: "succeeded",
    });

    expect(backoff.waits).toEqual([2000]);
    const thread = (await getRun(admin, runId)).steps.at(-1);
    expect(thread).toMatchObject({ stepId: "thread", status: "succeeded", attempts: 2 });
  });

  it("fails the run after 3 attempts, waiting longer before each", async () => {
    const { admin, system, runId } = await adminRun();
    confident();
    const backoff = recordedBackoff();
    fakeNango.beforeProxy((path) => {
      if (path.includes("/threads/") && fakeNango.rateLimitsAnswered() === 0) {
        fakeNango.rateLimitSource(3 * NANGO_TRIES);
      }
    });

    expect(await executeRun(system, runId, undefined, backoff.sleep)).toEqual({ status: "failed" });

    expect(backoff.waits).toEqual([2000, 8000]);
    const run = await getRun(admin, runId);
    expect(run.status).toBe("failed");
    expect(run.steps.at(-1)).toMatchObject({
      stepId: "thread",
      status: "failed",
      attempts: 3,
      errorCode: "source_error",
      errorMessage: "The source answered 429.",
    });
  });

  it("fails the run on its first model step without retrying when credits are out", async () => {
    const { admin, system, runId } = await adminRun(threadSpec(), 0);
    const backoff = recordedBackoff();

    expect(await executeRun(system, runId, undefined, backoff.sleep)).toEqual({ status: "failed" });

    expect(fakeAiGateway.requests()).toEqual([]);
    expect(backoff.waits).toEqual([]);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "classify", status: "failed", attempts: 1, errorCode: "out_of_credits" },
    ]);
  });

  it("fails without retrying when the triggering message isn't in Gmail", async () => {
    const { orgA } = await seedTwoOrgs();
    const system = systemCtx(orgA.id);
    await grantCredits(system, 100);
    const inbox = await connectInbox(orgA.admin.ctx, orgA.admin.email, []);
    const workflowId = await publish(orgA.admin.ctx, threadSpec());
    const { runId } = await startRun(orgA.admin.ctx, workflowId, inbox.connectionId, "no-such-id");

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "failed",
    });
    expect((await getRun(orgA.admin.ctx, runId)).steps).toMatchObject([
      { stepId: "classify", attempts: 1, errorCode: "source_item_missing" },
    ]);
  });

  it("fails without retrying when the spreadsheet isn't there", async () => {
    const spec = threadSpec({
      steps: [
        {
          id: "prices",
          type: "tool",
          action: "google-sheet.read-range",
          input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
        },
      ],
    });
    const { admin, system, runId } = await adminRun(spec);

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "failed",
    });
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "prices", status: "failed", attempts: 1, errorCode: "source_item_missing" },
    ]);
  });
});

describe("a step's retries", () => {
  // Counts the thread reads the proxy serves, rate-limiting the first `failures` attempts.
  function threadReads(failures: number) {
    let reads = 0;
    fakeNango.beforeProxy((path) => {
      if (!path.includes("/threads/")) return;
      reads += 1;
      if (fakeNango.rateLimitsAnswered() === 0) fakeNango.rateLimitSource(failures * NANGO_TRIES);
    });
    return () => reads;
  }

  it("are steps of their own, with the wait before each a wait between steps, recorded", async () => {
    const { admin, system, runId } = await adminRun();
    confident();
    threadReads(1);
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep, runner.sleep)).toEqual({
      status: "succeeded",
    });

    expect(runner.ids.slice(-3)).toEqual(["thread", "thread:wait-1", "thread:attempt-2"]);
    expect(runner.waits).toEqual([{ id: "thread:wait-1", ms: 2000 }]);
    // The failed attempt hands on when the step began, and nothing of what it read.
    expect(runner.results().thread).toEqual({
      retry: { startedAt: expect.any(String) as unknown },
    });
    const thread = (await getRun(admin, runId)).steps.at(-1);
    expect(thread).toMatchObject({ stepId: "thread", status: "succeeded", attempts: 2 });
    expect(thread?.startedAt.toISOString()).toBe(
      (runner.results().thread as { retry: { startedAt: string } }).retry.startedAt,
    );
  });

  it("resume after a crash from the last finished attempt, neither trying nor waiting again", async () => {
    const { admin, system, runId } = await adminRun();
    confident();
    const reads = threadReads(2);
    const runner = recordingStepRunner();
    runner.crashAt("thread:attempt-3");

    await expect(executeRun(system, runId, runner.runStep, runner.sleep)).rejects.toThrow();
    const readsBeforeCrash = reads();
    expect(await executeRun(system, runId, runner.runStep, runner.sleep)).toEqual({
      status: "succeeded",
    });

    // Only the third attempt read the thread again.
    expect(reads()).toBe(readsBeforeCrash + 1);
    expect(runner.waits).toEqual([
      { id: "thread:wait-1", ms: 2000 },
      { id: "thread:wait-2", ms: 8000 },
    ]);
    expect((await getRun(admin, runId)).steps.at(-1)).toMatchObject({
      stepId: "thread",
      status: "succeeded",
      attempts: 3,
    });
  });
});
