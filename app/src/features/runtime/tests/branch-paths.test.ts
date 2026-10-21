import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, getRun, startRun } from "../server";
import { connectInbox, pricingQuestion, publish, recordingStepRunner } from "./run-helpers";

beforeEach(resetDatabase);

const SENDER = "ada@customer.test";
const SUBJECT = "Quote for 30 oak chairs";
/** What the extract step pulls out of the message: content, never to be recorded. */
const PRODUCT = "  Oak CHAIRS ";
const TOTAL = 2400;

const labelStep = (id: string, label: string) => ({
  id,
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label },
});
const isKind = (is: string) => ({ classify: "kind", is, minP: 0.8 });
const path = (id: string, checks: unknown[], steps: unknown[]) => ({
  id,
  name: id.replace(/^./, (first) => first.toUpperCase()),
  condition: { combine: "all", checks },
  steps,
});

/**
 * Classify the kind, extract the product and total, then a first-match branch: complaints to
 * a person, then pricing, then big orders of oak chairs, otherwise `otherwise`.
 */
function triage(otherwise: unknown[] = []): Record<string, unknown> & { steps: unknown[] } {
  return {
    specVersion: 2,
    id: "triage",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    autonomy: { rung: 3 },
    steps: [
      {
        id: "kind",
        type: "classify",
        role: "classify",
        question: "What kind of message is this?",
        labels: ["complaint", "pricing", "other"],
      },
      {
        id: "details",
        type: "extract",
        role: "fast",
        fields: {
          product: { type: "string", description: "What they ask about" },
          total: { type: "number", description: "The order total" },
        },
      },
      {
        id: "route",
        type: "branch",
        mode: "first",
        paths: [
          path("complaint", [isKind("complaint")], [labelStep("complaint-label", "Complaint")]),
          path("pricing", [isKind("pricing")], [labelStep("pricing-label", "Pricing")]),
          path(
            "big",
            [
              { subject: { from: "details.product" }, op: "is", value: "oak chairs" },
              { subject: { from: "details.total" }, op: "more_than", value: 1000 },
            ],
            [labelStep("big-label", "Big order")],
          ),
        ],
        otherwise: { id: "rest", steps: otherwise },
      },
    ],
  };
}

async function triageRun(spec: Record<string, unknown> = triage()) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [
    pricingQuestion({ from: SENDER, subject: SUBJECT }),
  ]);
  const workflowId = await publish(admin, spec);
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, inbox.messages[0].id);
  return { admin, system, runId, mailbox: inbox.mailbox };
}

/** Jev's probabilities over the kinds, `p` for the one it chose. */
function decided(kind: string, p: number): Record<string, number> {
  const kinds = ["complaint", "pricing", "other"];
  const rest = (1 - p) / (kinds.length - 1);
  return Object.fromEntries(kinds.map((each) => [each, each === kind ? p : rest]));
}

/** The classify step's answer, then the extract step's. */
function answers(kind: string, extracted = { product: PRODUCT, total: TOTAL }, p = 0.9) {
  fakeAiGateway.decision({ choice: kind, probabilities: decided(kind, p) }, { costUsd: 0 });
  fakeAiGateway.object(extracted, { costUsd: 0 });
}

describe("a branch with several paths, first match", () => {
  it("runs the first path whose condition holds, left to right, checking no path after it", async () => {
    const { admin, system, runId } = await triageRun();
    answers("pricing");
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(runner.ids).toEqual(["kind", "details", "route", "pricing-label"]);
    const route = (await getRun(admin, runId)).steps.find((step) => step.stepId === "route");
    expect(route?.output).toEqual({
      taken: ["pricing"],
      paths: [
        { id: "complaint", holds: false, checks: [false] },
        { id: "pricing", holds: true, checks: [true] },
      ],
    });
  });

  it("checks extracted text ignoring case and surrounding spaces, and numbers by value", async () => {
    const { system, runId } = await triageRun();
    answers("other");
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(runner.ids).toEqual(["kind", "details", "route", "big-label"]);
  });

  it("runs the otherwise path only when no path holds, and stops on an empty one", async () => {
    const handled = await triageRun(triage([labelStep("rest-label", "Other")]));
    answers("pricing", { product: PRODUCT, total: 500 }, 0.5);
    const runner = recordingStepRunner();
    expect(await executeRun(handled.system, handled.runId, runner.runStep)).toEqual({
      status: "succeeded",
    });
    expect(runner.ids).toEqual(["kind", "details", "route", "rest-label"]);

    await resetDatabase();
    const stopped = await triageRun();
    answers("other", { product: "Pine tables", total: TOTAL });
    expect(await executeRun(stopped.system, stopped.runId)).toEqual({ status: "skipped" });
  });

  it("replays down the same path after a crash midway through it", async () => {
    const { admin, system, runId } = await triageRun();
    answers("pricing");
    const runner = recordingStepRunner();
    runner.crashAt("pricing-label");

    await expect(executeRun(system, runId, runner.runStep)).rejects.toThrow("crashed");
    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(fakeAiGateway.requests()).toHaveLength(2);
    expect(runner.ids.slice(4)).toEqual(["kind", "details", "route", "pricing-label"]);
    expect((await getRun(admin, runId)).steps.map((step) => step.stepId)).toEqual([
      "kind",
      "details",
      "route",
      "pricing-label",
    ]);
  });

  it("keeps no subject, sender or extracted value in the run's records or step state", async () => {
    const { admin, system, runId } = await triageRun();
    answers("other");
    const runner = recordingStepRunner();

    await executeRun(system, runId, runner.runStep);

    const route = JSON.stringify(runner.results().route);
    const records = JSON.stringify(await getRun(admin, runId));
    for (const kept of [route, records]) {
      for (const content of [SENDER, SUBJECT, "oak", "Oak", String(TOTAL)]) {
        expect(kept).not.toContain(content);
      }
    }
  });
});

describe("an approval on a path", () => {
  it("collects only the drafts on its own path, not those an approval above already has", async () => {
    const reply = (id: string) => ({
      id,
      type: "draft",
      role: "smart",
      instructions: "Reply briefly.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
    });
    const spec = triage();
    const route = spec.steps[2] as { paths: { steps: unknown[] }[] };
    route.paths[1].steps = [
      reply("reply"),
      { id: "approve", type: "approval", channel: "gmail_drafts" },
    ];
    spec.steps.splice(2, 0, reply("ack"));
    const { admin, system, runId, mailbox } = await triageRun(spec);
    answers("pricing");
    fakeAiGateway.text("Thanks, we're on it.", { costUsd: 0 });
    fakeAiGateway.text("Oak chairs are 80 GBP each.", { costUsd: 0 });

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const [ack, priced] = mailbox.drafts().map((draft) => draft.id);
    const approvals = (await getRun(admin, runId)).steps.filter((step) => step.type === "approval");
    expect(approvals.map((step) => [step.stepId, step.output])).toEqual([
      ["ack-approval", { awaiting: "human", channel: "gmail_drafts", draftIds: [ack] }],
      ["approve", { awaiting: "human", channel: "gmail_drafts", draftIds: [priced] }],
    ]);
  });
});
