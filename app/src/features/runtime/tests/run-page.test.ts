// A run's page: its steps, the path it took on the workflow graph, the reviews it created and
// the message it ran on, by the Runs page's rules. A member sees their own runs in full; an
// admin every run, a colleague's redacted to what happened without what it read (ADR-0001).
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { reviewsOfRun } from "@/features/reviews/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { explainFailure } from "../failure-texts";
import { executeRun, getRun, getRunMessage, startRun } from "../server";
import { INTERNAL_ERROR_MESSAGE } from "../types";
import { company } from "./company-runs";
import { extractWith, pricingQuestion, publish, runOn } from "./run-helpers";

beforeEach(resetDatabase);

const SUBJECT = "MARKER-subject-41d0";
const BODY = "MARKER-body-9b2c";
const DRAFT = "MARKER-generated-draft-e6a7";

/** Classify, then on the pricing path draft a reply and wait for its review. */
const replySpec = {
  specVersion: 2,
  id: "pricing-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "kind",
      type: "classify",
      role: "classify",
      question: "Is this a pricing inquiry?",
      labels: ["yes", "no"],
    },
    {
      id: "route",
      type: "branch",
      mode: "first",
      paths: [
        {
          id: "pricing",
          name: "Pricing",
          condition: { combine: "all", checks: [{ classify: "kind", is: "yes", minP: 0.8 }] },
          steps: [
            {
              id: "draft",
              type: "draft",
              role: "smart",
              instructions: "Reply with our current prices.",
              context: ["trigger.message"],
              output: "google-mail.create-draft",
            },
            { id: "approve", type: "approval", channel: "gmail_drafts" },
          ],
        },
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
  autonomy: { rung: 3 },
};

/** The reply workflow, run to the end on a pricing question in the member's own inbox. */
async function colleagueReply() {
  const setup = await company();
  const { admin, member, colleague } = setup;
  const promoted: Ctx = { ...member, role: "admin" };
  const message = colleague.mailbox.add(pricingQuestion({ subject: SUBJECT, text: BODY }));
  const workflowId = await publish(admin, replySpec);
  const { runId } = await startRun(promoted, workflowId, colleague.connectionId, message.id);
  fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.95, no: 0.05 } });
  fakeAiGateway.text(DRAFT, { costUsd: 0.002 });
  expect(await executeRun(systemCtx(admin.orgId), runId)).toEqual({ status: "succeeded" });
  const [draft] = colleague.mailbox.drafts();
  return { ...setup, workflowId, runId, message, draft };
}

describe("a succeeded run", () => {
  it("shows its owner its steps, the path it took, its reviews and its message", async () => {
    const { orgA, member, runId, message } = await colleagueReply();

    const run = await getRun(member, runId);

    expect(run).toMatchObject({
      id: runId,
      full: true,
      workflowName: "pricing-replies",
      version: { number: 1 },
      inbox: { kind: "yours", accountEmail: orgA.member.email },
      sourceRef: message.id,
      status: "succeeded",
      errorCode: null,
    });
    expect(run.steps.map((step) => [step.stepId, step.status, step.path])).toEqual([
      ["kind", "succeeded", null],
      ["route", "succeeded", null],
      ["draft", "succeeded", "Pricing"],
      ["approve", "succeeded", "Pricing"],
    ]);
    expect(run.steps.at(0)).toMatchObject({ attempts: 1, modelRole: "classify" });
    // The graph lights the steps it ran and the path the branch took, each check with how it went.
    expect(run.trace.steps).toEqual([
      { stepId: "kind", status: "succeeded" },
      {
        stepId: "route",
        status: "succeeded",
        paths: [
          {
            id: "pricing",
            status: "taken",
            checks: [
              { check: expect.stringContaining("yes") as string, passed: true, reason: "passed" },
            ],
          },
          { id: "rest", status: "not_needed", checks: [] },
        ],
      },
      { stepId: "draft", status: "succeeded" },
      { stepId: "approve", status: "succeeded" },
    ]);
    expect(await reviewsOfRun(member, runId)).toEqual([
      {
        id: expect.any(String) as string,
        kind: "approval",
        status: "waiting",
        createdAt: expect.any(Date) as Date,
        endedAt: null,
        openable: true,
      },
    ]);
    expect(await getRunMessage(member, runId)).toEqual({
      sourceRef: message.id,
      subject: SUBJECT,
      from: expect.stringContaining("ada@customer.test") as string,
      link: expect.stringContaining(message.threadId) as string,
    });
  });

  it("shows an admin a colleague's run redacted: its steps, path and reviews, not its mail", async () => {
    const { orgA, admin, runId } = await colleagueReply();

    const run = await getRun(admin, runId);

    expect(run).toMatchObject({
      full: false,
      sourceRef: null,
      inbox: { kind: "colleague", ownerName: orgA.member.email },
      status: "succeeded",
    });
    expect(run.steps.map((step) => [step.stepId, step.status, step.output])).toEqual([
      ["kind", "succeeded", null],
      ["route", "succeeded", null],
      ["draft", "succeeded", null],
      ["approve", "succeeded", null],
    ]);
    // The path it took still shows, without which of its checks passed.
    expect(run.trace.steps.at(1)?.paths).toEqual([
      { id: "pricing", status: "taken", checks: [] },
      { id: "rest", status: "not_needed", checks: [] },
    ]);
    expect(await reviewsOfRun(admin, runId)).toMatchObject([
      { kind: "approval", status: "waiting", openable: false },
    ]);
    expect(await getRunMessage(admin, runId)).toBeNull();
  });

  it("never gives an admin anything a colleague's run read, made or handed on", async () => {
    const { admin, member, runId, message, draft } = await colleagueReply();
    const markers = [SUBJECT, BODY, DRAFT, message.id, message.threadId, draft.id];

    const given = JSON.stringify([
      await getRun(admin, runId),
      await getRunMessage(admin, runId),
      await reviewsOfRun(admin, runId),
    ]);

    for (const marker of markers) expect(given).not.toContain(marker);
    // Its owner is given the message and what its steps recorded.
    const owners = JSON.stringify([
      await getRun(member, runId),
      await getRunMessage(member, runId),
    ]);
    for (const marker of [SUBJECT, message.id, message.threadId, draft.id]) {
      expect(owners).toContain(marker);
    }
  });
});

describe("who may open a run", () => {
  it("lets a member open their own run, not a colleague's or the org's", async () => {
    const { member, run } = await company();
    const own = await run("colleague", "succeeded");
    const admins = await run("own", "succeeded");
    const orgs = await run("org", "succeeded");

    expect(await getRun(member, own)).toMatchObject({ id: own, full: true });
    await expect(getRun(member, admins)).rejects.toThrow(ForbiddenError);
    await expect(getRun(member, orgs)).rejects.toThrow(ForbiddenError);
    expect(await getRunMessage(member, admins)).toBeNull();
  });

  it("shows an admin their own runs and the org's in full", async () => {
    const { admin, orgMessage, run } = await company();
    const own = await run("own", "succeeded");
    const orgs = await run("org", "succeeded");

    expect(await getRun(admin, own)).toMatchObject({ full: true, inbox: { kind: "yours" } });
    expect(await getRun(admin, orgs)).toMatchObject({
      full: true,
      sourceRef: orgMessage.id,
      inbox: { kind: "org" },
    });
    expect(await getRunMessage(admin, orgs)).toMatchObject({ subject: "Shared question" });
  });
});

describe("a run that failed", () => {
  it("shows which check failed and why, after the ones that passed", async () => {
    const { admin, system, runId } = await runOn([
      extractWith({
        schema: { type: "object", required: ["quantity"] },
        requiredFields: ["city", "deadline", "quantity"],
      }),
    ]);
    fakeAiGateway.object({ quantity: 30, city: "", deadline: null }, { costUsd: 0 });
    expect(await executeRun(system, runId)).toEqual({ status: "failed" });

    const run = await getRun(admin, runId);

    expect(run.steps).toMatchObject([
      {
        stepId: "details",
        status: "check_failed",
        errorCode: "check_required_fields",
        checks: [
          { check: "schema", status: "passed", reason: null },
          {
            check: "requiredFields",
            status: "failed",
            reason: "The requiredFields check failed: city, deadline not filled.",
          },
        ],
      },
    ]);
    expect(run.trace.steps).toEqual([{ stepId: "details", status: "check_failed" }]);
    expect(await reviewsOfRun(admin, runId)).toEqual([]);
    expect(explainFailure("check_required_fields", run.steps[0].errorMessage)).toMatchObject({
      summary: "A required field came back empty.",
      detail: "The requiredFields check failed: city, deadline not filled.",
      ours: false,
    });
  });

  it("shows a step Google refused access to, and says to reconnect", async () => {
    const { admin, system, runId, sheets } = await runOn([
      {
        id: "prices",
        type: "tool",
        action: "google-sheet.read-range",
        input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
      },
    ]);
    sheets.add("sheet-1", "Prices", [["Chair", "80"]]);
    sheets.deny("sheet-1");
    expect(await executeRun(system, runId)).toEqual({ status: "failed" });

    const run = await getRun(admin, runId);

    expect(run).toMatchObject({ status: "failed", errorCode: null });
    expect(run.steps).toMatchObject([
      { stepId: "prices", status: "failed", errorCode: "source_forbidden", checks: [] },
    ]);
    expect(run.trace.steps).toEqual([{ stepId: "prices", status: "failed" }]);
    const text = explainFailure(run.steps[0].errorCode, run.steps[0].errorMessage);
    expect(text.todo).toContain("Reconnect Google");
  });

  it("says an internal error is ours to fix, whatever its record says", () => {
    expect(explainFailure("internal_error", "Something else entirely")).toEqual({
      summary: INTERNAL_ERROR_MESSAGE,
      detail: null,
      todo: expect.any(String) as string,
      ours: true,
    });
  });
});
