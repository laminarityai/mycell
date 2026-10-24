import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { disconnect } from "@/features/connections/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, startRun } from "../server";
import { pricingQuestion, publish, recordedBackoff, recordsOf, threadSpec } from "./run-helpers";
import { recordingStepRunner } from "@/testing/recording-step-runner";

beforeEach(resetDatabase);

const PRICES = [
  ["Item", "Unit price", "Lead time"],
  ["Oak chair", "80 GBP", "5 days"],
  ["Walnut table", "640 GBP", "3 weeks"],
];
const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered in 5 days.";

/** The architecture's example spec, price sheet and all. */
function exampleSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-inquiry-replies",
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

/** Org A's admin's Google account, with a pricing question and a price sheet. */
async function sheetRun(spec: Record<string, unknown> = exampleSpec()) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add(pricingQuestion());
  google.sheets.add("sheet-1", "Prices", PRICES);
  const workflowId = await publish(admin, spec);
  const { runId } = await startRun(admin, workflowId, google.id, message.id);
  return { admin, system, google, message, workflowId, runId };
}

describe("the read-range action", () => {
  it("gives the draft the sheet's prices, and records only the range's counts", async () => {
    const { admin, system, google, message, runId } = await sheetRun();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.95, no: 0.05 } });
    fakeAiGateway.text(REPLY);

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const drafts = google.mailbox.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      threadId: message.threadId,
      headers: { to: "ada@customer.test" },
    });
    const prompt = JSON.stringify(fakeAiGateway.requests("language").at(0)?.body);
    for (const cell of ["Oak chair", "80 GBP", "Walnut table", "3 weeks"]) {
      expect(prompt).toContain(cell);
    }
    const run = await getRun(admin, runId);
    expect(run.steps).toMatchObject([
      { stepId: "classify", status: "succeeded", output: { label: "yes" } },
      { stepId: "gate", status: "succeeded" },
      {
        stepId: "prices",
        status: "succeeded",
        output: {
          fields: {
            range: { kind: "text", size: "Prices!A1:C50".length },
            rowCount: { kind: "number" },
            columnCount: { kind: "number" },
          },
        },
      },
      {
        stepId: "draft",
        status: "succeeded",
        output: { draftId: drafts[0]?.id, threadId: message.threadId },
      },
      { stepId: "approve", status: "succeeded", output: { awaiting: "human" } },
    ]);
    expect(recordsOf(run)).not.toContain("Oak chair");
  });

  it("counts an empty range as no rows", async () => {
    const pricesStep = (exampleSpec().steps as Record<string, unknown>[])[2];
    const { system, google, runId } = await sheetRun(threadSpec({ steps: [pricesStep] }));
    google.sheets.add("sheet-1", "Prices", []);
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });
    expect(runner.results()).toMatchObject({
      prices: { output: { range: "Prices!A1:C50", rowCount: 0, columnCount: 0 } },
    });
  });
});

/** Logs the message to the sheet: who asked, and a formula that must stay text. */
const logStep = {
  id: "log",
  type: "tool",
  action: "google-sheet.append-row",
  input: {
    spreadsheetId: "sheet-1",
    range: "Log!A:C",
    values: [{ from: "trigger.messageId" }, "pricing", "=1+1"],
  },
};

async function logRun() {
  const run = await sheetRun(threadSpec({ steps: [logStep] }));
  run.google.sheets.add("sheet-1", "Log", [["Message", "Kind", "Note"]]);
  return run;
}

describe("the append-row action", () => {
  it("finds its earlier row anywhere in the range's sheet, past the range it was given", async () => {
    const narrow = { ...logStep, input: { ...logStep.input, range: "Log!A1:C1" } };
    const { admin, system, google, runId } = await sheetRun(threadSpec({ steps: [narrow] }));
    google.sheets.add("sheet-1", "Log", [["Message", "Kind", "Note"]]);
    google.sheets.loseNextAnswer();

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "succeeded",
    });

    expect(google.sheets.appends).toHaveLength(1);
    expect(google.sheets.rows("sheet-1", "Log")).toHaveLength(2);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "log", attempts: 2, output: { fields: { updatedRange: { kind: "text" } } } },
    ]);
  });

  it("appends one row after the table, as typed, and hands on the range it wrote", async () => {
    const { admin, system, google, message, runId } = await logRun();
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(google.sheets.rows("sheet-1", "Log")).toEqual([
      ["Message", "Kind", "Note"],
      [message.id, "pricing", "=1+1", `mycel:${runId}/log`],
    ]);
    expect(google.sheets.appends.map((append) => append.valueInputOption)).toEqual(["RAW"]);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "log",
        status: "succeeded",
        output: { fields: { updatedRange: { kind: "text", size: "Log!A2:D2".length } } },
      },
    ]);
    expect(runner.results()).toMatchObject({ log: { output: { updatedRange: "Log!A2:D2" } } });
  });

  it("appends exactly one row when its first answer was lost and it's tried again", async () => {
    const { admin, system, google, runId } = await logRun();
    google.sheets.loseNextAnswer();

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "succeeded",
    });

    expect(google.sheets.appends).toHaveLength(1);
    expect(google.sheets.rows("sheet-1", "Log")).toHaveLength(2);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "log", attempts: 2, output: { fields: { updatedRange: { kind: "text" } } } },
    ]);
  });
});

const draftStep = {
  id: "draft",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
};
const approveStep = { id: "approve", type: "approval", channel: "gmail_drafts" };

describe("an approval step", () => {
  it("records that the draft awaits a person, and lets the steps after it run", async () => {
    const { admin, system, google, runId } = await sheetRun(
      threadSpec({ steps: [draftStep, approveStep, logStep] }),
    );
    google.sheets.add("sheet-1", "Log", [["Message", "Kind", "Note"]]);
    fakeAiGateway.text(REPLY);

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const draftIds = google.mailbox.drafts().map((draft) => draft.id);
    expect(draftIds).toHaveLength(1);
    expect(google.sheets.rows("sheet-1", "Log")).toHaveLength(2);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "draft", status: "succeeded" },
      {
        stepId: "approve",
        status: "succeeded",
        output: { awaiting: "human", channel: "gmail_drafts", draftIds },
      },
      { stepId: "log", status: "succeeded" },
    ]);
  });

  it("before a draft, still lets the draft be made: the draft is what awaits the person", async () => {
    const { admin, system, google, runId } = await sheetRun(
      threadSpec({ steps: [approveStep, draftStep] }),
    );
    fakeAiGateway.text(REPLY);

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect(google.mailbox.drafts()).toHaveLength(1);
    // The approval above the draft ran before it was made, so the policy engine adds one after.
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "approve", status: "succeeded" },
      { stepId: "draft", status: "succeeded" },
      { stepId: "draft-approval", status: "succeeded" },
    ]);
  });
});

describe("a sheet step on a disconnected Google connection", () => {
  const pricesStep = (exampleSpec().steps as Record<string, unknown>[])[2];

  it("ends the run cancelled when Nango no longer has the connection", async () => {
    const { admin, system, google, runId } = await sheetRun(threadSpec({ steps: [pricesStep] }));
    fakeNango.deleteWithoutWebhook(google.nangoConnectionId);

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "cancelled",
    });
    expect(await getRun(admin, runId)).toMatchObject({ status: "cancelled", steps: [] });
  });

  it("ends the run cancelled, and takes it away, when it's disconnected mid-run", async () => {
    const { admin, system, google, runId } = await sheetRun(threadSpec({ steps: [pricesStep] }));
    fakeNango.beforeProxy(async (path) => {
      if (path.startsWith("/v4/spreadsheets")) await disconnect(admin, google.id);
    });

    expect(await executeRun(system, runId)).toEqual({ status: "cancelled" });
    await expect(getRun(admin, runId)).rejects.toThrow(NotFoundError);
  });
});
