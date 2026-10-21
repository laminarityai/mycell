import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { dryRun } from "../server";
import { pricingQuestion } from "./run-helpers";

beforeEach(resetDatabase);

const labelStep = (id: string, label: string) => ({
  id,
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label },
});
const path = (id: string, checks: unknown[]) => ({
  id,
  name: id,
  condition: { combine: "all", checks },
  steps: [labelStep(`${id}-label`, id)],
});

/** Classify and extract, then complaints, pricing questions, and big orders of oak chairs. */
const triage = {
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
      paths: [
        path("complaint", [{ classify: "kind", is: "complaint", minP: 0.8 }]),
        path("pricing", [{ classify: "kind", is: "pricing", minP: 0.8 }]),
        path("big", [
          { subject: { from: "details.product" }, op: "contains", value: "oak" },
          { subject: { from: "details.total" }, op: "more_than", value: 1000 },
        ]),
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
};

async function tryTriage(kind: string, extracted: Record<string, unknown>, spec: unknown = triage) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await grantCredits(systemCtx(orgA.id), 100);
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add(pricingQuestion());
  const others = ["complaint", "pricing", "other"].filter((each) => each !== kind);
  fakeAiGateway.decision({
    choice: kind,
    probabilities: { [kind]: 0.93, ...Object.fromEntries(others.map((o) => [o, 0.035])) },
  });
  fakeAiGateway.object(extracted);
  return dryRun(admin, spec, { connectionId: google.id, sourceRef: message.id });
}

describe("Try it on a branch with several paths", () => {
  it("says which path ran, which failed and which weren't checked, and why", async () => {
    const result = await tryTriage("pricing", { product: "Oak chairs", total: 2400 });

    expect(result.steps.map((step) => step.stepId)).toEqual([
      "kind",
      "details",
      "route",
      "pricing-label",
    ]);
    expect(result.steps[2]?.paths).toEqual([
      {
        id: "complaint",
        name: "complaint",
        status: "not_taken",
        checks: [
          {
            check: '"kind" says "complaint" with at least 80% confidence',
            passed: false,
            reason: 'said "pricing", 93% sure',
          },
        ],
      },
      {
        id: "pricing",
        name: "pricing",
        status: "taken",
        checks: [
          {
            check: '"kind" says "pricing" with at least 80% confidence',
            passed: true,
            reason: 'said "pricing", 93% sure',
          },
        ],
      },
      { id: "big", name: "big", status: "not_checked", checks: [] },
      { id: "rest", name: null, status: "not_needed", checks: [] },
    ]);
  });

  it("shows the admin the values each check tested, and takes the otherwise path when none holds", async () => {
    const result = await tryTriage("other", { product: "Oak chairs", total: null });

    expect(result.ended).toBe("skipped");
    expect(result.steps.at(-1)?.paths?.slice(2)).toEqual([
      {
        id: "big",
        name: "big",
        status: "not_taken",
        checks: [
          { check: 'what they ask about contains "oak"', passed: true, reason: 'was "Oak chairs"' },
          { check: "the order total is more than 1000", passed: false, reason: "had no value" },
        ],
      },
      { id: "rest", name: null, status: "taken", checks: [] },
    ]);
  });
});

describe("Try it on an every-match branch", () => {
  it("runs each path that holds, left to right, and ends partly failed when one fails", async () => {
    const [route] = triage.steps.slice(2);
    const missingSheet = {
      id: "prices",
      type: "tool",
      action: "google-sheet.read-range",
      input: { spreadsheetId: "no-such-sheet", range: "Prices!A1:C50" },
    };
    const paths = [
      path("complaint", [{ classify: "kind", is: "complaint", minP: 0.8 }]),
      {
        ...path("pricing", [{ classify: "kind", is: "pricing", minP: 0.8 }]),
        steps: [missingSheet],
      },
      path("big", [{ subject: { from: "details.total" }, op: "more_than", value: 1000 }]),
    ];
    const spec = {
      ...triage,
      steps: [...triage.steps.slice(0, 2), { ...route, mode: "every", paths }],
    };

    const result = await tryTriage("pricing", { product: "Oak chairs", total: 2400 }, spec);

    expect(result.ended).toBe("partly_failed");
    expect(result.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["kind", "succeeded"],
      ["details", "succeeded"],
      ["route", "succeeded"],
      ["prices", "failed"],
      ["big-label", "succeeded"],
    ]);
    expect(result.steps[2]?.paths?.map((each) => [each.id, each.status])).toEqual([
      ["complaint", "not_taken"],
      ["pricing", "taken"],
      ["big", "taken"],
      ["rest", "not_needed"],
    ]);
    expect(result.steps[2]?.paths?.at(2)?.checks.map((each) => each.check)).toEqual([
      "the order total is more than 1000",
    ]);
  });
});
