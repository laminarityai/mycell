// A run whose job crashes past Inngest's retries ends `failed` with a run-level
// `internal_error`, instead of staying "running" (the run job's onFailure handler). Unexpected
// errors are logged by code and IDs only, never with content.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { ForbiddenError } from "@/lib/errors";
import type { RunStep } from "@/lib/inngest";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, failCrashedRun, getRun } from "../server";
import { INTERNAL_ERROR_MESSAGE } from "../types";
import { classifyWith, recordedBackoff, recordingStepRunner, runOn } from "./run-helpers";

beforeEach(resetDatabase);

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const readThread = {
  id: "thread",
  type: "tool",
  action: "google-mail.read-thread",
  input: { threadId: { from: "trigger.threadId" } },
};

// What the triggering message says (run-helpers' pricing question): never in a log line.
const CONTENT = ["Quote for 30 oak chairs", "oak chairs", "Leeds", "ada@customer.test"];

const confident = () => {
  fakeAiGateway.decision(
    { choice: "yes", probabilities: { yes: 0.9, no: 0.1 } },
    { costUsd: 0.25 },
  );
};

describe("failCrashedRun", () => {
  it("ends a run its crashed job left running as failed, with an internal error", async () => {
    const { admin, system, runId } = await runOn([classifyWith(), readThread]);
    confident();
    const runner = recordingStepRunner();
    runner.crashAt("thread");
    await expect(executeRun(system, runId, runner.runStep)).rejects.toThrow();
    expect((await getRun(admin, runId)).status).toBe("running");

    await failCrashedRun(system, runId);

    const run = await getRun(admin, runId);
    expect(run).toMatchObject({ status: "failed", errorCode: "internal_error", costUsd: 0.25 });
    expect(run.finishedAt).not.toBeNull();
    // The steps that finished before the crash keep their records.
    expect(run.steps).toMatchObject([{ stepId: "classify", status: "succeeded" }]);
  });

  it("changes nothing when called again", async () => {
    const { admin, system, runId } = await runOn([readThread]);
    await failCrashedRun(system, runId);
    const ended = await getRun(admin, runId);

    await failCrashedRun(system, runId);

    expect(await getRun(admin, runId)).toEqual(ended);
    expect(logged).toHaveLength(1);
  });

  it("changes nothing for a run that already finished", async () => {
    const { admin, system, runId } = await runOn([readThread]);
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });
    const finished = await getRun(admin, runId);

    await failCrashedRun(system, runId);

    expect(await getRun(admin, runId)).toEqual(finished);
    expect(finished.errorCode).toBeNull();
    expect(logged).toEqual([]);
  });

  it("logs the code and the run's ID, and nothing else", async () => {
    const { system, runId } = await runOn([readThread]);

    await failCrashedRun(system, runId);

    expect(logged).toEqual([[`internal_error run=${runId}`]]);
    for (const content of CONTENT) expect(JSON.stringify(logged)).not.toContain(content);
  });

  it("is only for the run job", async () => {
    const { admin, runId } = await runOn([readThread]);

    await expect(failCrashedRun(admin, runId)).rejects.toThrow(ForbiddenError);
    expect((await getRun(admin, runId)).status).toBe("running");
  });
});

describe("a step that fails unexpectedly", () => {
  it("logs the code and the run's and step's IDs, and nothing else", async () => {
    const { admin, system, runId } = await runOn([classifyWith(), readThread]);
    confident();
    // Nango stops answering once classify has read the message.
    const runStep: RunStep = (id, run) => {
      if (id === "thread") fakeNango.stopAnswering();
      return run();
    };

    expect(await executeRun(system, runId, runStep, recordedBackoff().sleep)).toEqual({
      status: "failed",
    });

    expect((await getRun(admin, runId)).steps.at(-1)).toMatchObject({
      stepId: "thread",
      errorCode: "internal_error",
      errorMessage: INTERNAL_ERROR_MESSAGE,
    });
    expect(logged).toEqual([[`internal_error run=${runId} step=thread`]]);
    for (const content of CONTENT) expect(JSON.stringify(logged)).not.toContain(content);
  });
});
