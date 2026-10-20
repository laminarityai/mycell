import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { switchWorkflowOff, switchWorkflowOn } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { gmailMessageReceived, type GmailMessageReceived } from "@/lib/events";
import { connectMailbox } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { executeRun, getRun, listRuns, startTriggeredRuns } from "../server";
import type { RunStep } from "../types";
import { pricingQuestion, publish, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

// Two read-only steps, so a run needs no model and has a step after its first.
const readSteps = [
  {
    id: "message",
    type: "tool",
    action: "google-mail.read-message",
    input: { messageId: { from: "trigger.messageId" } },
  },
  {
    id: "thread",
    type: "tool",
    action: "google-mail.read-thread",
    input: { threadId: { from: "trigger.threadId" } },
  },
];

const readSpec = (id: string, overrides: Record<string, unknown> = {}) =>
  threadSpec({ id, steps: readSteps, ...overrides });

/** Connects and backfills a mailbox, so polls find what arrives next. */
async function backfilledInbox(ctx: Ctx, email: string, kind: "member" | "org" = "member") {
  const inbox = await connectMailbox(ctx, email, [], kind);
  await backfillConnection(ctx, inbox.id);
  return inbox;
}

/**
 * Polls the connection as the cron would, and hands each trigger event the poll sent to the
 * fan-out, as Inngest would. Returns the runs started.
 */
async function pollAndFanOut(orgId: string, connectionId: string) {
  const system = systemCtx(orgId);
  const before = fakeInngest.sent(gmailMessageReceived.name).length;
  await pollConnection(system, connectionId);
  const runIds: string[] = [];
  for (const event of fakeInngest.sent(gmailMessageReceived.name).slice(before)) {
    const data = gmailMessageReceived.schema.parse(event.data);
    runIds.push(...(await startTriggeredRuns(system, data)).runIds);
  }
  return runIds;
}

async function adminWithInbox() {
  const orgs = await seedTwoOrgs();
  const admin = orgs.orgA.admin.ctx;
  const inbox = await backfilledInbox(admin, orgs.orgA.admin.email);
  return { ...orgs, admin, inbox, system: systemCtx(orgs.orgA.id) };
}

const arriving = (overrides: Partial<FakeMessageInput> = {}) =>
  pricingQuestion({ at: new Date(), ...overrides });

describe("a polled message", () => {
  it("starts one run for each enablement and org workflow switched on for its connection", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const support = await backfilledInbox(admin, "support@org-a.test", "org");
    const first = await publish(admin, readSpec("first"));
    const second = await publish(admin, readSpec("second"));
    const shared = await publish(admin, readSpec("shared", { credentials: "org" }));
    await switchWorkflowOn(admin, first, inbox.id);
    await switchWorkflowOn(admin, second, inbox.id);
    await switchWorkflowOn(admin, shared, support.id);
    const message = inbox.mailbox.add(arriving());
    support.mailbox.add(arriving());

    const runIds = await pollAndFanOut(orgA.id, inbox.id);

    expect(runIds).toHaveLength(2);
    const runs = [...(await listRuns(admin, first)), ...(await listRuns(admin, second))];
    expect(runs).toMatchObject([
      { connectionId: inbox.id, sourceRef: message.id, status: "running" },
      { connectionId: inbox.id, sourceRef: message.id, status: "running" },
    ]);
    expect(runs.map((run) => run.enablementId)).toEqual([expect.any(String), expect.any(String)]);
    expect(fakeInngest.sent("runtime/run.requested").map((event) => event.id)).toEqual(
      runIds.map((runId) => `run-${runId}`),
    );

    const supportRuns = await pollAndFanOut(orgA.id, support.id);
    expect(supportRuns).toHaveLength(1);
    expect(await listRuns(admin, shared)).toMatchObject([
      { connectionId: support.id, ownerScope: "org", enablementId: null, status: "running" },
    ]);
  });

  it("starts a run that executes the workflow's latest version on it", async () => {
    const { orgA, admin, inbox, system } = await adminWithInbox();
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    inbox.mailbox.add(arriving());

    const [runId] = await pollAndFanOut(orgA.id, inbox.id);

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });
    expect((await getRun(admin, runId)).steps.map((step) => step.stepId)).toEqual([
      "message",
      "thread",
    ]);
  });

  it("starts nothing when it occurred before the switch-on", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    // Gmail dates a message by when it was sent, so one can arrive dated before the switch-on.
    inbox.mailbox.add(arriving({ at: new Date(Date.now() - 60 * 60 * 1000) }));

    expect(await pollAndFanOut(orgA.id, inbox.id)).toEqual([]);
  });

  it("starts nothing without one of the trigger's labels", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    // Filtered straight past the inbox.
    inbox.mailbox.add(arriving({ labelIds: ["CATEGORY_UPDATES"] }));

    expect(await pollAndFanOut(orgA.id, inbox.id)).toEqual([]);
  });

  it("starts nothing for a workflow switched on for someone else's connection", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const theirs = await backfilledInbox(orgA.member.ctx, orgA.member.email);
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    theirs.mailbox.add(arriving());

    expect(await pollAndFanOut(orgA.id, theirs.id)).toEqual([]);
    expect(await listRuns(admin, workflowId)).toEqual([]);
  });

  it("starts one run when its trigger event comes twice", async () => {
    const { orgA, admin, inbox, system } = await adminWithInbox();
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    const message = inbox.mailbox.add(arriving());
    const event: GmailMessageReceived = {
      orgId: orgA.id,
      connectionId: inbox.id,
      sourceRef: message.id,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    };

    const first = await startTriggeredRuns(system, event);
    const again = await startTriggeredRuns(system, event);

    expect(await listRuns(admin, workflowId)).toHaveLength(1);
    expect(again.runIds).toEqual(first.runIds);
    // Sent again with the same event ID, in case the first send was lost: Inngest runs it once.
    expect(new Set(fakeInngest.sent("runtime/run.requested").map((e) => e.id)).size).toBe(1);
  });

  it("is fanned out only by the system ctx", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const event: GmailMessageReceived = {
      orgId: orgA.id,
      connectionId: inbox.id,
      sourceRef: "message-1",
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    };

    await expect(startTriggeredRuns(admin, event)).rejects.toThrow(ForbiddenError);
    await expect(startTriggeredRuns(orgA.member.ctx, event)).rejects.toThrow(ForbiddenError);
  });
});

describe("switching off mid-run", () => {
  // Runs the run, switching the workflow off once its first step has finished.
  async function runSwitchingOffAfterFirstStep(admin: Ctx, workflowId: string, runId: string) {
    const runStep: RunStep = async (id, run) => {
      const result = await run();
      if (id === "message") await switchWorkflowOff(admin, workflowId);
      return result;
    };
    return executeRun(systemCtx(admin.orgId), runId, runStep);
  }

  it("ends an enablement's run cancelled after its current step", async () => {
    const { orgA, admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, readSpec("reads"));
    await switchWorkflowOn(admin, workflowId, inbox.id);
    inbox.mailbox.add(arriving());
    const [runId] = await pollAndFanOut(orgA.id, inbox.id);

    expect(await runSwitchingOffAfterFirstStep(admin, workflowId, runId)).toEqual({
      status: "cancelled",
    });
    const run = await getRun(admin, runId);
    expect(run.status).toBe("cancelled");
    expect(run.steps.map((step) => step.stepId)).toEqual(["message"]);
  });

  it("ends an org workflow's run cancelled after its current step", async () => {
    const { orgA, admin } = await adminWithInbox();
    const support = await backfilledInbox(admin, "support@org-a.test", "org");
    const workflowId = await publish(admin, readSpec("shared", { credentials: "org" }));
    await switchWorkflowOn(admin, workflowId, support.id);
    support.mailbox.add(arriving());
    const [runId] = await pollAndFanOut(orgA.id, support.id);

    expect(await runSwitchingOffAfterFirstStep(admin, workflowId, runId)).toEqual({
      status: "cancelled",
    });
    expect((await getRun(admin, runId)).steps.map((step) => step.stepId)).toEqual(["message"]);
  });
});
