// Custom writes in a run (ADR-0018, ADR-0020): the tool step sends nothing. It holds the
// rendered request, encrypted with the company's key, and the approval after it puts it on the
// Reviews page. Try it shows the exact request instead, sending nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { heldReplySpec, heldSend, OUTLOOK_MESSAGE } from "@/db/testing/held-sends";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listReviews } from "@/features/reviews/server";
import { fakeKms } from "@/testing/fake-kms";
import { dryRun, getRun } from "../server";
import type { RunStep } from "../types";

beforeEach(resetDatabase);

const MARKER = "MARKER-held-5d1e-oak-chairs";
const TEXT = `Thanks Ada, 30 oak chairs come to 2,400 GBP. ${MARKER}`;

const writes = (requests: { method: string }[]) => requests.filter((r) => r.method !== "GET");

describe("a custom write in a run", () => {
  it("sends nothing, and holds the request for its review", async () => {
    const orgs = await seedTwoOrgs();
    const { owner, outcome, runId, outlook } = await heldSend(orgs, { text: TEXT });

    expect(outcome).toEqual({ status: "succeeded" });
    expect(writes(outlook.requests)).toEqual([]);
    expect(await listReviews(owner)).toMatchObject([
      { kind: "held_send", workflowName: "Outlook replies" },
    ]);
    const run = await getRun(owner, runId);
    expect(run.steps.map((step) => [step.stepId, step.status])).toEqual([
      ["read", "succeeded"],
      ["reply", "succeeded"],
      ["reply-approval", "succeeded"],
    ]);
    expect(run.steps.at(2)?.output).toMatchObject({ awaiting: "human", channel: "held_send" });
  });

  it("keeps the request's text in no table, encrypted with the company's own key", async () => {
    const orgs = await seedTwoOrgs();
    const keysBefore = fakeKms.dataKeyOwners().length;

    await heldSend(orgs, { text: TEXT });

    expect(await tablesHolding(MARKER)).toEqual([]);
    expect(await tablesHolding("oak chairs come to")).toEqual([]);
    const orgAKey = fakeKms
      .listKeys()
      .find(({ aliases }) => aliases.includes(`alias/mycel/org/${orgs.orgA.id}`))?.keyId;
    expect(fakeKms.dataKeyOwners().slice(keysBefore)).toEqual([orgAKey]);
    for (const material of fakeKms.keyMaterial()) {
      expect(await tablesHolding(material)).toEqual([]);
    }
  });

  it("holds one request with one review, however often its steps are retried", async () => {
    const orgs = await seedTwoOrgs();
    const twice: RunStep = async (_id, run) => {
      await run();
      return run();
    };

    const { owner, outlook } = await heldSend(orgs, { runStep: twice });

    expect(await listReviews(owner)).toHaveLength(1);
    expect(writes(outlook.requests)).toEqual([]);
  });
});

describe("a custom write in Try it", () => {
  it("shows the exact request it would send, and sends nothing", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, google, message, outlook } = await heldSend(orgs, { text: TEXT });
    const before = outlook.requests.length;

    const result = await dryRun(admin, heldReplySpec(), {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(result.steps.map((step) => [step.stepId, step.effect])).toEqual([
      ["read", null],
      [
        "reply",
        {
          kind: "request",
          app: "Microsoft 365",
          action: "microsoft.reply-to-message",
          method: "POST",
          url: `https://graph.microsoft.com/v1.0/me/messages/${OUTLOOK_MESSAGE}/reply`,
          body: { comment: TEXT },
        },
      ],
      ["reply-approval", { kind: "review", channel: "held_send" }],
    ]);
    expect(outlook.requests.length).toBe(before);
  });
});
