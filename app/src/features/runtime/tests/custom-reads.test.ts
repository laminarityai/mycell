// Custom reads end to end (ADR-0018): a published workflow runs a company's custom action, one
// call to a registered app through the run owner's connection to it, and its typed result
// fields reach later steps. Try it runs it for real too.
import { beforeEach, describe, expect, it } from "vitest";
import { readOutlookMessage, storeCustomAction } from "@/db/testing/custom-actions";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectApp, connectGoogle } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { dryRun, executeRun, getRun, startRun } from "../server";
import { pricingQuestion, publish } from "./run-helpers";

beforeEach(resetDatabase);

const OUTLOOK_ID = "AAMkAGI2-outlook-1";
const SUBJECT = "Order 4417 shipped";
const SENDER = "orders@supplier.test";

/** Reads one Outlook message with the custom read, then logs its subject and sender to a sheet. */
const spec = {
  specVersion: 2,
  id: "outlook-log",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  autonomy: { rung: 3 },
  steps: [
    {
      id: "outlook",
      type: "tool",
      action: "microsoft.read-message",
      input: { messageId: OUTLOOK_ID },
    },
    {
      id: "log",
      type: "tool",
      action: "google-sheet.append-row",
      input: {
        spreadsheetId: "sheet-1",
        range: "Log!A:B",
        values: [{ from: "outlook.subject" }, { from: "outlook.sender" }],
      },
    },
  ],
};

/** Org A's admin with Google and Microsoft 365 connected, and the custom read stored. */
async function setUp() {
  const { orgA, orgB } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(admin, orgA.admin.email);
  const gmail = google.mailbox.add(pricingQuestion());
  google.sheets.add("sheet-1", "Log", []);
  const connected = await connectApp(admin, "microsoft", orgA.admin.email);
  const outlook = fakeNango.microsoft(connected.connectionId);
  outlook.addMessage({ id: OUTLOOK_ID, subject: SUBJECT, from: SENDER, body: "Tracking: 1Z" });
  await storeCustomAction(admin, readOutlookMessage());
  const microsoft = connected.id ?? "";
  return { orgA, orgB, admin, system, google, gmail, microsoft, outlook };
}

describe("a custom read in a run", () => {
  it("calls the registered app once, and its fields reach a later step", async () => {
    const { admin, system, google, gmail, outlook } = await setUp();
    const workflowId = await publish(admin, spec);
    const before = outlook.requests.length;
    const { runId } = await startRun(admin, workflowId, google.id, gmail.id);

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect(outlook.requests.slice(before)).toEqual([
      { method: "GET", path: `/v1.0/me/messages/${OUTLOOK_ID}`, query: {}, body: undefined },
    ]);
    expect(google.sheets.rows("sheet-1", "Log")).toEqual([[SUBJECT, SENDER, `mycel:${runId}/log`]]);
    const run = await getRun(admin, runId);
    expect(run.steps.at(0)).toMatchObject({
      stepId: "outlook",
      status: "succeeded",
      output: {
        fields: {
          subject: { kind: "text", size: SUBJECT.length },
          sender: { kind: "text", size: SENDER.length },
          isRead: { kind: "yes_no" },
        },
      },
    });
  });

  it("fails the step, sending nothing, when its owner has no connection to the app", async () => {
    const { admin, system, google, gmail, microsoft, outlook } = await setUp();
    const workflowId = await publish(admin, spec);
    await disconnect(admin, microsoft);
    const before = outlook.requests.length;
    const { runId } = await startRun(admin, workflowId, google.id, gmail.id);

    expect(await executeRun(system, runId)).toEqual({ status: "failed" });

    expect(outlook.requests.length).toBe(before);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "outlook",
        status: "failed",
        errorCode: "app_not_connected",
        errorMessage: "The run's account has no Microsoft 365 connection to call it through.",
      },
    ]);
  });
});

describe("a custom read in Try it", () => {
  it("runs for real and shows its result", async () => {
    const { admin, google, gmail, outlook } = await setUp();
    const before = outlook.requests.length;

    const result = await dryRun(admin, spec, { connectionId: google.id, sourceRef: gmail.id });

    expect(result.steps.at(0)).toMatchObject({
      stepId: "outlook",
      status: "succeeded",
      output: { subject: SUBJECT, sender: SENDER, isRead: false },
    });
    expect(outlook.requests.slice(before)).toHaveLength(1);
    // The append after it is stubbed, as every write is.
    expect(google.sheets.rows("sheet-1", "Log")).toEqual([]);
  });
});

describe("another company's custom action", () => {
  it("isn't in the company's action set, so its spec doesn't save", async () => {
    const { orgB } = await setUp();
    await connectGoogle(orgB.admin.ctx, orgB.admin.email);
    await connectApp(orgB.admin.ctx, "microsoft", orgB.admin.email);

    await expect(publish(orgB.admin.ctx, spec)).rejects.toMatchObject({
      issues: [
        {
          path: ["steps", 0, "action"],
          message: `"microsoft.read-message" isn't a catalog action or one of the org's custom actions.`,
        },
      ],
    });
  });
});
