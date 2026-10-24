// Runs pass content between steps (ADR-0021): a later step uses text an earlier step read,
// from the step state rather than fetching it again. The run records keep only each result
// field's kind and size, and what Inngest stores of the step state is ciphertext under the app
// key.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { decryptStepState } from "@/testing/inngest-step-state";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, startRun } from "../server";
import {
  pricingQuestion,
  publish,
  recordingStepRunner,
  recordsOf,
  stepStateRecorder,
  threadSpec,
} from "./run-helpers";

beforeEach(resetDatabase);

const MARKER = "MARKER-7f3a9c-oak-chairs-body";
const BODY = `Hello, what would 30 oak chairs cost delivered to Leeds? ${MARKER}`;
const SUBJECT = "Quote for 30 oak chairs";

/** Reads the triggering message, then logs its subject and body to a sheet. */
const steps = [
  {
    id: "read",
    type: "tool",
    action: "google-mail.read-message",
    input: { messageId: { from: "trigger.messageId" } },
  },
  {
    id: "log",
    type: "tool",
    action: "google-sheet.append-row",
    input: {
      spreadsheetId: "sheet-1",
      range: "Log!A:B",
      values: [{ from: "read.subject" }, { from: "read.body" }],
    },
  },
];

/** Org A's admin's Google account, with a message carrying MARKER and an empty log sheet. */
async function logRun() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add(pricingQuestion({ subject: SUBJECT, text: BODY }));
  google.sheets.add("sheet-1", "Log", []);
  const workflowId = await publish(admin, threadSpec({ steps }));
  const { runId } = await startRun(admin, workflowId, google.id, message.id);
  // Every proxied path the run asks for, to count how often it fetches the message.
  const fetched: string[] = [];
  fakeNango.beforeProxy((path) => {
    fetched.push(path);
  });
  return { admin, system, google, message, workflowId, runId, fetched };
}

describe("a run passing content between steps", () => {
  it("hands the body a step read to a later step, from the step state, fetching it once", async () => {
    const { system, google, message, runId, fetched } = await logRun();
    const runner = recordingStepRunner();
    runner.crashAt("log");

    // The invocation dies after the read; Inngest replays the read from its step state.
    await expect(executeRun(system, runId, runner.runStep)).rejects.toThrow("crashed before log");
    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(google.sheets.rows("sheet-1", "Log")).toEqual([[SUBJECT, BODY, `mycel:${runId}/log`]]);
    const reads = fetched.filter((path) => path.includes(`/messages/${message.id}`));
    expect(reads).toHaveLength(1);
  });

  it("records each result field's kind and size, and no table holds the body", async () => {
    const { admin, system, message, runId } = await logRun();

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const run = await getRun(admin, runId);
    expect(run.steps).toMatchObject([
      {
        stepId: "read",
        status: "succeeded",
        output: {
          fields: {
            messageId: { kind: "text", size: message.id.length },
            threadId: { kind: "text", size: message.threadId.length },
            labelIds: { kind: "list", size: message.labelIds.length },
            from: { kind: "text", size: "ada@customer.test".length },
            subject: { kind: "text", size: SUBJECT.length },
            body: { kind: "text", size: BODY.length },
          },
        },
      },
      {
        stepId: "log",
        status: "succeeded",
        output: { fields: { updatedRange: { kind: "text", size: "Log!A1:C1".length } } },
      },
    ]);
    const records = recordsOf(run);
    for (const content of [MARKER, SUBJECT, "Log!A1:C1"]) {
      expect(records).not.toContain(content);
    }
    expect(await tablesHolding(MARKER)).toEqual([]);
  });

  it("stores only ciphertext at Inngest, which the app key decrypts back", async () => {
    const { system, runId } = await logRun();
    const recorder = stepStateRecorder();

    expect(await executeRun(system, runId, recorder.runStep)).toEqual({ status: "succeeded" });

    const stored = recorder.state.join("\n");
    expect(stored).not.toBe("");
    for (const content of [MARKER, SUBJECT]) expect(stored).not.toContain(content);

    const decrypted = await decryptStepState(recorder.state, env.INNGEST_ENCRYPTION_KEY ?? "");
    expect(decrypted).toMatchObject([
      { id: "read", result: { ended: null, output: { subject: SUBJECT, body: BODY } } },
      { id: "log", result: { ended: null, output: { updatedRange: "Log!A1:C1" } } },
    ]);
    await expect(
      decryptStepState(recorder.state, "not-the-app-key-but-just-as-long-as-it"),
    ).rejects.toThrow();
  });
});
