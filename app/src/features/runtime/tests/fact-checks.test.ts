import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, startRun } from "../server";
import {
  connectInbox,
  pricingQuestion,
  publish,
  recordingStepRunner,
  recordsOf,
} from "./run-helpers";

beforeEach(resetDatabase);

const SENDER = "Ada Lovelace <ada@customer.test>";
const SUBJECT = "Quote for 30 oak chairs";
const INVOICE = { filename: "invoice.pdf", mimeType: "application/pdf", size: 2048 };

const labelStep = (id: string, label: string) => ({
  id,
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label },
});
const check = (from: string, op: string, value?: string | number) => ({
  subject: { from },
  op,
  ...(value === undefined ? {} : { value }),
});
const path = (id: string, combine: "all" | "any", checks: unknown[]) => ({
  id,
  name: id,
  condition: { combine, checks },
  steps: [labelStep(`${id}-label`, id)],
});

/**
 * Look the sender up in a sheet, then: a supplier's invoice; a known customer's new message; a
 * quote request by its subject or sender; otherwise stop. No model step, so no model call.
 */
const routing = {
  specVersion: 2,
  id: "routing",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  autonomy: { rung: 3 },
  steps: [
    {
      id: "lookup",
      type: "tool",
      action: "google-sheet.read-range",
      input: { spreadsheetId: "customers", range: "Customers!A:B" },
    },
    {
      id: "route",
      type: "branch",
      paths: [
        path("invoice", "all", [
          check("trigger.senderDomain", "is", "Supplier.test"),
          check("trigger.hasAttachment", "is_yes"),
        ]),
        path("known", "all", [
          check("lookup.rowCount", "more_than", 0),
          check("trigger.isReply", "is_no"),
        ]),
        path("quote", "any", [
          check("trigger.subject", "contains", "quote"),
          check("trigger.sender", "is", "orders@customer.test"),
        ]),
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
};

/** Runs `routing` on `message`, with `rows` in the customers sheet. */
async function routed(message: Partial<FakeMessageInput>, rows: string[][] = []) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion(message)]);
  fakeNango.sheets(inbox.nangoConnectionId).add("customers", "Customers", rows);
  const workflowId = await publish(admin, routing);
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, inbox.messages[0].id);
  const runner = recordingStepRunner();
  const outcome = await executeRun(system, runId, runner.runStep);
  return { outcome, taken: runner.ids.at(-1), runner, run: await getRun(admin, runId) };
}

describe("a branch testing the trigger's facts and a tool step's result", () => {
  it("tests the sender's domain and whether the message has an attachment", async () => {
    const { outcome, taken } = await routed({
      from: "Bo Ng <bo@supplier.test>",
      attachments: [INVOICE],
    });

    expect(outcome).toEqual({ status: "succeeded" });
    expect(taken).toBe("invoice-label");
  });

  it("tests a sheet lookup's row count and whether the message is a reply", async () => {
    const known = await routed({ from: SENDER }, [["Ada Lovelace", "ada@customer.test"]]);
    expect(known.taken).toBe("known-label");

    await resetDatabase();
    const reply = await routed(
      { from: SENDER, subject: "Re: chairs", headers: { "In-Reply-To": "<m1@customer.test>" } },
      [["Ada Lovelace", "ada@customer.test"]],
    );
    expect(reply.outcome).toEqual({ status: "skipped" });
  });

  it("tests the subject, and the sender's address without their name", async () => {
    const bySubject = await routed({ from: SENDER, subject: SUBJECT });
    expect(bySubject.taken).toBe("quote-label");

    await resetDatabase();
    const bySender = await routed({ from: "Orders <ORDERS@customer.test>", subject: "Hello" });
    expect(bySender.taken).toBe("quote-label");
  });

  it("keeps no subject or sender in the run's records or step state", async () => {
    const { run, runner } = await routed({ from: SENDER, subject: SUBJECT });

    const kept = [recordsOf(run), JSON.stringify(runner.results())];
    for (const record of kept) {
      for (const content of ["Ada", "ada@", "customer.test", "oak", "Quote for"]) {
        expect(record).not.toContain(content);
      }
    }
    expect(run.steps.find((step) => step.stepId === "route")?.output).toEqual({
      taken: ["quote"],
      paths: [
        { id: "invoice", holds: false, checks: [false, false] },
        { id: "known", holds: false, checks: [false, true] },
        { id: "quote", holds: true, checks: [true, false] },
      ],
    });
  });
});
