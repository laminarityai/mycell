import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, getRun } from "../server";
import { classifyWith, extractWith, OFF_SCHEMA, recordedBackoff, runOn } from "./run-helpers";

beforeEach(resetDatabase);

describe("a step's checks", () => {
  it("fail a classify below its minP floor, without a retry", async () => {
    const { admin, system, runId } = await runOn([classifyWith({ minP: 0.95 })]);
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const backoff = recordedBackoff();

    expect(await executeRun(system, runId, undefined, backoff)).toEqual({ status: "failed" });

    expect(backoff.waits).toEqual([]);
    expect(fakeAiGateway.requests()).toHaveLength(1);
    const run = await getRun(admin, runId);
    expect(run.status).toBe("failed");
    expect(run.steps).toMatchObject([
      {
        stepId: "classify",
        status: "check_failed",
        attempts: 1,
        errorCode: "check_min_p",
        errorMessage: "The minP check failed: p is below 0.95.",
      },
    ]);
  });

  it("fail an output that doesn't match the schema, naming where and why, without a retry", async () => {
    const schema = {
      type: "object",
      required: ["quantity", "city"],
      properties: {
        quantity: { type: "integer", minimum: 1 },
        city: { type: "string", enum: ["Leeds", "York"] },
        deadline: { type: "string" },
      },
    };
    const { admin, system, runId } = await runOn([extractWith({ schema })]);
    fakeAiGateway.object({ quantity: 0, city: "Hull", deadline: null }, { costUsd: 0 });
    const backoff = recordedBackoff();

    expect(await executeRun(system, runId, undefined, backoff)).toEqual({ status: "failed" });

    expect(backoff.waits).toEqual([]);
    expect(fakeAiGateway.requests()).toHaveLength(1);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "details",
        status: "check_failed",
        attempts: 1,
        errorCode: "check_schema",
        errorMessage:
          "The schema check failed: city is not one of the allowed values; " +
          "deadline is null, not a string; quantity is below the minimum 1.",
      },
    ]);
  });

  it("pass an output that matches every check", async () => {
    const schema = {
      type: "object",
      properties: { label: { enum: ["yes", "no"] }, p: { type: "number", maximum: 1 } },
    };
    const { admin, system, runId } = await runOn([classifyWith({ schema, minP: 0.8 })]);
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "classify", status: "succeeded", errorCode: null },
    ]);
  });

  it("count a model answer off the step's own schema as a failed schema check", async () => {
    const { admin, system, runId } = await runOn([extractWith({ schema: { type: "object" } })]);
    fakeAiGateway.object({ quantity: OFF_SCHEMA, city: "Leeds" }, { costUsd: 0 });
    const backoff = recordedBackoff();

    expect(await executeRun(system, runId, undefined, backoff)).toEqual({ status: "failed" });

    expect(backoff.waits).toEqual([]);
    expect(fakeAiGateway.requests()).toHaveLength(1);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "details",
        status: "check_failed",
        attempts: 1,
        errorCode: "check_schema",
        errorMessage: "The schema check failed: the fast model's answer didn't fit the step.",
      },
    ]);
  });

  it("fail an extract that leaves a required field unfilled, without a retry", async () => {
    const { admin, system, runId } = await runOn([
      extractWith({ requiredFields: ["city", "deadline", "quantity"] }),
    ]);
    fakeAiGateway.object({ quantity: 30, city: "", deadline: null }, { costUsd: 0 });
    const backoff = recordedBackoff();

    expect(await executeRun(system, runId, undefined, backoff)).toEqual({ status: "failed" });

    expect(backoff.waits).toEqual([]);
    expect(fakeAiGateway.requests()).toHaveLength(1);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "details",
        status: "check_failed",
        attempts: 1,
        errorCode: "check_required_fields",
        errorMessage: "The requiredFields check failed: city, deadline not filled.",
      },
    ]);
  });
});

describe("a model answer off the step's schema, with no schema check", () => {
  it("is retried, and after 3 attempts fails the run with when the last one began", async () => {
    const { admin, system, runId } = await runOn([extractWith({ requiredFields: ["city"] })]);
    for (let attempt = 0; attempt < 3; attempt++) {
      fakeAiGateway.object({ quantity: OFF_SCHEMA }, { costUsd: 0 });
    }
    // Real waits, short, so the last attempt begins measurably after the first.
    const backoff = { ...recordedBackoff(), sleep: realSleep };

    expect(await executeRun(system, runId, undefined, backoff)).toEqual({ status: "failed" });

    expect(fakeAiGateway.requests()).toHaveLength(3);
    const run = await getRun(admin, runId);
    expect(run.status).toBe("failed");
    const [step] = run.steps;
    expect(step).toMatchObject({
      stepId: "details",
      status: "failed",
      attempts: 3,
      errorCode: "model_off_schema",
      errorMessage: "The fast model call to test/fast-default failed: off_schema.",
    });
    const sinceStart = step.lastAttemptAt.getTime() - step.startedAt.getTime();
    expect(sinceStart).toBeGreaterThanOrEqual(2 * WAIT_MS);
    expect(step.lastAttemptAt.getTime()).toBeLessThanOrEqual(step.finishedAt.getTime());
  });
});

const WAIT_MS = 25;

function realSleep(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WAIT_MS);
  });
}
