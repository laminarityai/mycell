import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseTimeZone, setDatabaseTimeZone } from "@/db/testing/database-time-zone";
import { resetDatabase } from "@/db/testing/reset";
import { listLedger } from "@/features/credits/server";
import { getWorkflow } from "@/features/workflows/server";
import { executeRun, getRun } from "../server";
import { runOn } from "./run-helpers";

// A database outside UTC, like the local Postgres in America/Los_Angeles.
beforeAll(() => setDatabaseTimeZone("America/Los_Angeles"));
afterAll(resetDatabaseTimeZone);
beforeEach(resetDatabase);

const readMessage = {
  id: "message",
  type: "tool",
  action: "google-mail.read-message",
  input: { messageId: { from: "trigger.messageId" } },
};

/** Expects `time` within a minute of now: a time zone mix-up shifts it by whole hours. */
function expectNow(time: Date | null | undefined) {
  expect(time).toBeInstanceOf(Date);
  expect(Math.abs((time as Date).getTime() - Date.now())).toBeLessThan(60_000);
}

describe("recorded times on a database outside UTC", () => {
  it("read back as the moment they were recorded", async () => {
    const { admin, system, runId, workflowId } = await runOn([readMessage]);

    await executeRun(system, runId);

    const workflow = await getWorkflow(admin, workflowId);
    expectNow(workflow.updatedAt);
    expectNow(workflow.versions[0].publishedAt);
    const run = await getRun(admin, runId);
    expect(run.status).toBe("succeeded");
    expectNow(run.startedAt);
    expectNow(run.finishedAt);
    expectNow(run.steps[0].startedAt);
    expectNow(run.steps[0].finishedAt);
    expectNow(run.steps[0].lastAttemptAt);
    const ledger = await listLedger(admin);
    expect(ledger.length).toBeGreaterThan(0);
    for (const entry of ledger) expectNow(entry.createdAt);
  });
});
