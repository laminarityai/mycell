import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { failQueries } from "@/db/testing/fail-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listConnections } from "@/features/connections/server";
import { getBalance, grantCredits, listLedger } from "@/features/credits/server";
import { spendingKindOf } from "@/features/credits/types";
import { saveWorkflow } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError, OutOfCreditsError } from "@/lib/errors";
import { connectGoogle, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { dryRun, listRuns, recentMessages } from "../server";
import { pricingQuestion } from "./run-helpers";

beforeEach(resetDatabase);

const PRICES = [
  ["Item", "Unit price"],
  ["Oak chair", "80 GBP"],
];
const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP.";

const classify = {
  id: "classify",
  type: "classify",
  role: "classify",
  question: "Is this a pricing inquiry?",
  labels: ["yes", "no"],
};
const gate = {
  id: "gate",
  type: "branch",
  when: { step: "classify", label: "yes", minP: 0.8 },
  else: "stop",
};
const prices = {
  id: "prices",
  type: "tool",
  action: "google-sheet.read-range",
  input: { spreadsheetId: "sheet-1", range: "Prices!A1:B10" },
};
const draft = {
  id: "draft",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message", "prices"],
  output: "google-mail.create-draft",
};
const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};
const logRow = {
  id: "log",
  type: "tool",
  action: "google-sheet.append-row",
  input: { spreadsheetId: "sheet-1", range: "Log!A1", values: ["pricing", 1] },
};

function specOf(steps: Record<string, unknown>[]) {
  return {
    specVersion: 1,
    id: "pricing-replies",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps,
    autonomy: { rung: 3 },
  };
}

/** Org A's admin's Google account, with a pricing question and a price sheet. */
async function tryItSetup(credits = 100) {
  const { orgA, orgB } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  if (credits > 0) await grantCredits(systemCtx(orgA.id), credits);
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add(pricingQuestion());
  google.sheets.add("sheet-1", "Prices", PRICES);
  google.sheets.add("sheet-1", "Log", [["kind", "count"]]);
  return { orgA, orgB, admin, google, message };
}

function noWrites(google: Awaited<ReturnType<typeof connectGoogle>>) {
  expect(google.mailbox.writes.log).toEqual([]);
  expect(google.mailbox.drafts()).toEqual([]);
  expect(google.sheets.appends).toEqual([]);
}

describe("recentMessages", () => {
  it("lists the newest 20 messages across the admin's own and org connections, never a member's", async () => {
    const { orgA, admin, google } = await tryItSetup();
    for (let i = 1; i <= 21; i++) {
      google.mailbox.add(pricingQuestion({ subject: `Order ${String(i)}`, at: daysAgo(i) }));
    }
    const support = await connectGoogle(admin, "support@org-a.test", {
      kind: "org",
      messages: [
        pricingQuestion({ subject: "Shared inbox question", at: daysAgo(5.5) }),
        pricingQuestion({ subject: "Old shared question", at: daysAgo(30) }),
      ],
    });
    await connectGoogle(orgA.member.ctx, orgA.member.email, {
      messages: [pricingQuestion({ subject: "A member's own mail" })],
    });

    const listing = await recentMessages(admin);

    expect(listing.map((connection) => connection.connectionId)).toEqual([google.id, support.id]);
    const own = listing[0]?.messages ?? [];
    // 19 of the admin's own and 1 of the org's are the newest 20 of both.
    expect(own).toHaveLength(19);
    expect(own[0]).toMatchObject({ subject: "Quote for 30 oak chairs", from: "ada@customer.test" });
    expect(own.at(-1)).toMatchObject({ subject: "Order 18" });
    expect(listing[1]?.messages.map((m) => m.subject)).toEqual(["Shared inbox question"]);
    expect(JSON.stringify(listing)).not.toContain("A member's own mail");
  });

  it("lists only the connections a spec's credentials could run on", async () => {
    const { admin } = await tryItSetup();
    const support = await connectGoogle(admin, "support@org-a.test", { kind: "org" });

    const listing = await recentMessages(admin, "org");

    expect(listing.map((connection) => connection.connectionId)).toEqual([support.id]);
  });

  it("says a connection is unavailable when Gmail refuses it or Nango no longer has it", async () => {
    const { admin, google } = await tryItSetup();
    const gone = await connectGoogle(admin, "sales@org-a.test", { kind: "org" });
    const support = await connectGoogle(admin, "support@org-a.test", {
      kind: "org",
      messages: [pricingQuestion({ subject: "Shared inbox question" })],
    });
    fakeNango.revokeAccess(google.nangoConnectionId);
    fakeNango.deleteWithoutWebhook(gone.nangoConnectionId);

    const listing = await recentMessages(admin);

    expect(listing.map(({ connectionId, unavailable }) => ({ connectionId, unavailable }))).toEqual(
      [
        { connectionId: google.id, unavailable: true },
        { connectionId: gone.id, unavailable: true },
        { connectionId: support.id, unavailable: false },
      ],
    );
    expect(listing[2]?.messages.map((m) => m.subject)).toEqual(["Shared inbox question"]);
  });

  it("says a connection is unavailable when Nango doesn't answer", async () => {
    const { admin, google } = await tryItSetup();
    fakeNango.stopAnswering();

    const listing = await recentMessages(admin);

    expect(listing).toMatchObject([{ connectionId: google.id, messages: [], unavailable: true }]);
  });

  it("lets a database error through rather than reading it as Gmail unavailable", async () => {
    const { admin } = await tryItSetup();
    // The database goes once the connections are listed, as their inboxes are read.
    const listing = await countQueries(() => listConnections(admin));
    const restore = failQueries({ after: listing.queries });

    try {
      await expect(recentMessages(admin)).rejects.toHaveProperty(
        "cause.message",
        "The database is unavailable.",
      );
    } finally {
      restore();
    }
  });
});

describe("dryRun", () => {
  it("shows each step's output, the rows read and the draft's text, writing nothing", async () => {
    const { admin, google, message } = await tryItSetup();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.92, no: 0.08 } });
    fakeAiGateway.text(REPLY);

    const result = await dryRun(admin, specOf([classify, gate, prices, draft]), {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.ended).toBe("succeeded");
    expect(result.steps).toMatchObject([
      { stepId: "classify", status: "succeeded", output: { label: "yes", p: 0.92 } },
      { stepId: "gate", status: "succeeded", output: { taken: ["gate-yes"] } },
      {
        stepId: "prices",
        status: "succeeded",
        effect: { kind: "rows_read", range: "Prices!A1:B10", rows: PRICES },
      },
      {
        stepId: "draft",
        status: "succeeded",
        effect: { kind: "draft", to: "ada@customer.test", text: REPLY },
      },
      // The policy engine's approval after the draft.
      { type: "approval", insertedByPolicy: true, effect: { kind: "review" } },
    ]);
    noWrites(google);
  });

  it("reports the label and the row it would add, sending Gmail and Sheets no write", async () => {
    const { admin, google, message } = await tryItSetup();

    const result = await dryRun(admin, specOf([label, logRow]), {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result).toMatchObject({
      ended: "succeeded",
      costUsd: 0,
      steps: [
        { stepId: "label", effect: { kind: "label", label: "Pricing" } },
        { stepId: "log", effect: { kind: "row", range: "Log!A1", values: ["pricing", 1] } },
      ],
    });
    noWrites(google);
    expect(google.mailbox.labelNamesOf(message.id)).not.toContain("Pricing");
  });

  it("records no run, and debits the ledger by the scripted cost, marked as a dry run", async () => {
    const { admin, google, message } = await tryItSetup();
    const spec = specOf([classify, gate, prices, draft]);
    const { id: workflowId } = await saveWorkflow(admin, { name: "Pricing replies", spec });
    fakeAiGateway.decision(
      { choice: "yes", probabilities: { yes: 0.92, no: 0.08 } },
      { costUsd: 0.001 },
    );
    fakeAiGateway.text(REPLY, { costUsd: 0.02 });

    const result = await dryRun(admin, spec, {
      connectionId: google.id,
      sourceRef: message.id,
      workflowId,
    });

    expect(result.costUsd).toBeCloseTo(0.021);
    expect(await listRuns(admin, workflowId)).toEqual([]);
    const usage = (await listLedger(admin)).filter((entry) => entry.kind === "usage");
    expect(usage).toHaveLength(2);
    for (const entry of usage) {
      expect(entry).toMatchObject({ dryRun: true, workflowId, runId: null });
      expect(spendingKindOf(entry)).toBe("try_it");
    }
    expect(usage.reduce((sum, entry) => sum + entry.amount, 0)).toBeCloseTo(-21);
    expect(await getBalance(admin)).toBeCloseTo(79);
  });

  it("is refused out of credits, before any model is called", async () => {
    const { admin, google, message } = await tryItSetup(0);

    await expect(
      dryRun(admin, specOf([classify, gate, prices, draft]), {
        connectionId: google.id,
        sourceRef: message.id,
      }),
    ).rejects.toBeInstanceOf(OutOfCreditsError);
    expect(fakeAiGateway.requests()).toEqual([]);
  });

  it("finds no member's connection but the admin's own", async () => {
    const { orgA, admin, message } = await tryItSetup();
    const members = await connectGoogle(orgA.member.ctx, orgA.member.email);

    await expect(
      dryRun(admin, specOf([label]), { connectionId: members.id, sourceRef: message.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops where the branch stops, as a run would", async () => {
    const { admin, google, message } = await tryItSetup();
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.1, no: 0.9 } });

    const result = await dryRun(admin, specOf([classify, gate, label]), {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.ended).toBe("skipped");
    expect(result.steps.map((step) => step.stepId)).toEqual(["classify", "gate"]);
    expect(result.steps[1]).toMatchObject({ output: { taken: ["gate-otherwise"] } });
  });
});
