// Retrying a failed run (#174): whoever reads its connection (the member on their own inbox, an
// admin on an org connection or their own) starts a new run of the workflow's latest version on
// the same message, linked to the run it retries. Refused on a colleague's inbox, on a run that
// didn't fail, on a paused or archived workflow, and without credits.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import { recordUsage } from "@/features/credits/server";
import {
  archiveWorkflow,
  enable,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, OutOfCreditsError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  checkRetry,
  executeRun,
  failCrashedRun,
  getRun,
  listRuns,
  retryRun,
  startTriggeredRuns,
} from "../server";
import { pricingQuestion, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

const readMessage = {
  id: "message",
  type: "tool",
  action: "google-mail.read-message",
  input: { messageId: { from: "trigger.messageId" } },
};
const readThread = {
  id: "thread",
  type: "tool",
  action: "google-mail.read-thread",
  input: { threadId: { from: "trigger.threadId" } },
};
const addLabel = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};

// Read steps only, so a run needs no model.
const reads = (id: string, overrides: Record<string, unknown> = {}) =>
  threadSpec({ id, steps: [readMessage], ...overrides });

// Org A: the member has a member workflow on for their own inbox, and an org workflow is
// switched on for the shared sales inbox. A message arrives in each, and each run's job crashes,
// so both runs end failed: a passing hiccup, which a retry gets past.
async function company() {
  const { orgA } = await seedTwoOrgs({ credits: FUNDED_CREDITS });
  const { admin, member } = orgA;
  const system = systemCtx(orgA.id);
  // Saving checks the admin's own Gmail.
  await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email);
  const sales = await connectGoogle(admin.ctx, `sales@${orgA.workspaceDomain}`, { kind: "org" });
  await tagUsers(admin.ctx, "sales", [member]);
  const replies = await publishTo(admin.ctx, "Replies", reads("replies"), ["sales"]);
  const shared = await publishTo(admin.ctx, "Shared", reads("shared", { credentials: "org" }), [
    "sales",
  ]);
  await enable(member.ctx, replies.workflowId);
  await switchWorkflowOn(admin.ctx, shared.workflowId, sales.id);

  const crashedRunOn = async (inbox: typeof sales) => {
    const message = inbox.mailbox.add(pricingQuestion({ at: new Date() }));
    const { runIds } = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: inbox.id,
      sourceRef: message.id,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    const runId = runIds[0];
    await failCrashedRun(system, runId);
    return { runId, sourceRef: message.id };
  };
  const memberRun = await crashedRunOn(memberInbox);
  const orgRun = await crashedRunOn(sales);
  return { orgA, admin, member, system, memberInbox, sales, replies, shared, memberRun, orgRun };
}

const requested = (runId: string) =>
  fakeInngest.sent("runtime/run.requested").filter((event) => event.data.runId === runId);

async function republish(admin: Ctx, workflowId: string, name: string, spec: unknown) {
  await saveWorkflow(admin, { workflowId, name, spec });
  return publishWorkflow(admin, workflowId);
}

describe("retryRun", () => {
  it("lets a member retry a failed run on their own inbox, on the same message", async () => {
    const { member, system, memberInbox, memberRun } = await company();

    const { runId } = await retryRun(member.ctx, memberRun.runId);

    expect(runId).not.toBe(memberRun.runId);
    expect(await getRun(member.ctx, runId)).toMatchObject({
      status: "running",
      startedBy: "retry",
      retryOfRunId: memberRun.runId,
      connectionId: memberInbox.id,
      sourceRef: memberRun.sourceRef,
      enablementId: null,
    });
    expect(requested(runId)).toMatchObject([{ data: { runId, connectionId: memberInbox.id } }]);
    // The retry goes through where the crashed run didn't.
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });
  });

  it("lets an admin retry a failed run on an org connection", async () => {
    const { admin, system, sales, orgRun } = await company();

    const { runId } = await retryRun(admin.ctx, orgRun.runId);

    expect(await getRun(admin.ctx, runId)).toMatchObject({
      startedBy: "retry",
      retryOfRunId: orgRun.runId,
      connectionId: sales.id,
      sourceRef: orgRun.sourceRef,
    });
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });
  });

  it("runs the workflow's latest version, and links the run it retries to its retry", async () => {
    const { admin, member, replies, memberRun } = await company();
    const second = await republish(admin.ctx, replies.workflowId, "Replies", {
      ...reads("replies", { steps: [readMessage, readThread] }),
      visibility: { tags: ["sales"] },
    });

    const { runId } = await retryRun(member.ctx, memberRun.runId);

    expect(await getRun(member.ctx, runId)).toMatchObject({
      workflowVersionId: second.id,
      version: { number: 2 },
    });
    expect(await getRun(member.ctx, memberRun.runId)).toMatchObject({
      workflowVersionId: replies.version.id,
      retryOfRunId: null,
      retriedByRunId: runId,
    });
  });

  it("marks the retry on the Runs page", async () => {
    const { member, memberRun } = await company();

    const { runId } = await retryRun(member.ctx, memberRun.runId);

    const listed = (await listRuns(member.ctx, {})).runs;
    expect(listed.map((run) => [run.id, run.startedBy])).toEqual([
      [runId, "retry"],
      [memberRun.runId, "enablement"],
    ]);
  });

  it("starts one retry of a run however often it's asked, and none once that one ended", async () => {
    const { member, system, memberRun } = await company();

    const first = await retryRun(member.ctx, memberRun.runId);
    // Asked again while the retry runs, as a second click or a resend would: the same run.
    const again = await retryRun(member.ctx, memberRun.runId);

    expect(again).toEqual(first);
    expect((await listRuns(member.ctx, {})).runs).toHaveLength(2);
    await executeRun(system, first.runId);
    await expect(retryRun(member.ctx, memberRun.runId)).rejects.toThrow(ConflictError);
    expect(await checkRetry(member.ctx, memberRun.runId)).toEqual({
      allowed: false,
      why: "This run was retried already.",
    });
  });

  it("lets a failed retry be retried in turn", async () => {
    const { member, system, memberRun } = await company();
    const { runId } = await retryRun(member.ctx, memberRun.runId);
    await failCrashedRun(system, runId);

    const next = await retryRun(member.ctx, runId);

    expect(await getRun(member.ctx, next.runId)).toMatchObject({ retryOfRunId: runId });
  });
});

describe("a refused retry", () => {
  // What every refused retry leaves: no new run, and nothing asked of Inngest beyond the two
  // runs the messages started.
  async function nothingStarted(ctx: Ctx) {
    expect((await listRuns(ctx, {})).runs.every((run) => run.startedBy !== "retry")).toBe(true);
    expect(fakeInngest.sent("runtime/run.requested")).toHaveLength(2);
  }

  it("is refused to an admin on a colleague's inbox, naming whose it is", async () => {
    const { admin, member, memberRun } = await company();
    const why = `Only ${member.email} can retry a run on their own inbox.`;

    await expect(retryRun(admin.ctx, memberRun.runId)).rejects.toThrow(ForbiddenError);
    await expect(retryRun(admin.ctx, memberRun.runId)).rejects.toThrow(why);
    expect(await checkRetry(admin.ctx, memberRun.runId)).toEqual({ allowed: false, why });
    await nothingStarted(admin.ctx);
  });

  it("is refused to a member on an org connection", async () => {
    const { admin, member, orgRun } = await company();

    await expect(retryRun(member.ctx, orgRun.runId)).rejects.toThrow(ForbiddenError);
    await nothingStarted(admin.ctx);
  });

  it("is refused on a run that didn't fail", async () => {
    const { admin, member, system, memberRun } = await company();
    const { runId } = await retryRun(member.ctx, memberRun.runId);
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    await expect(retryRun(member.ctx, runId)).rejects.toThrow(ConflictError);
    expect(await checkRetry(member.ctx, runId)).toEqual({
      allowed: false,
      why: "Only a failed run can be retried.",
    });
    expect((await listRuns(admin.ctx, {})).runs).toHaveLength(3);
  });

  it("is refused while the workflow is paused for the member", async () => {
    const { admin, member, replies, memberRun } = await company();
    // A riskier version pauses the member's enablement until they switch it on again.
    await republish(admin.ctx, replies.workflowId, "Replies", {
      ...reads("replies", { steps: [readMessage, addLabel] }),
      visibility: { tags: ["sales"] },
    });

    await expect(retryRun(member.ctx, memberRun.runId)).rejects.toThrow(ConflictError);
    expect(await checkRetry(member.ctx, memberRun.runId)).toEqual({
      allowed: false,
      why: "Replies is paused: needs your OK for a riskier version. Switch it on again first.",
    });
    await nothingStarted(admin.ctx);
  });

  it("is refused while the workflow is archived", async () => {
    const { admin, shared, orgRun } = await company();
    await archiveWorkflow(admin.ctx, shared.workflowId);

    await expect(retryRun(admin.ctx, orgRun.runId)).rejects.toThrow(ConflictError);
    expect(await checkRetry(admin.ctx, orgRun.runId)).toEqual({
      allowed: false,
      why: "Shared is archived. Restore it first.",
    });
    await nothingStarted(admin.ctx);
  });

  it("is refused while the company is out of credits", async () => {
    const { admin, member, system, memberRun, orgRun } = await company();
    await recordUsage(system, {
      role: "fast",
      modelId: "openai/x",
      costUsd: FUNDED_CREDITS / env.CREDITS_PER_USD,
      outcome: "succeeded",
    });

    await expect(retryRun(member.ctx, memberRun.runId)).rejects.toThrow(OutOfCreditsError);
    await expect(retryRun(admin.ctx, orgRun.runId)).rejects.toThrow(OutOfCreditsError);
    expect(await checkRetry(admin.ctx, orgRun.runId)).toEqual({
      allowed: false,
      why: new OutOfCreditsError().message,
    });
    await nothingStarted(admin.ctx);
  });
});

describe("checkRetry", () => {
  it("allows the reader of a failed run's inbox to retry it", async () => {
    const { admin, member, memberRun, orgRun } = await company();

    expect(await checkRetry(member.ctx, memberRun.runId)).toEqual({ allowed: true });
    expect(await checkRetry(admin.ctx, orgRun.runId)).toEqual({ allowed: true });
  });
});
