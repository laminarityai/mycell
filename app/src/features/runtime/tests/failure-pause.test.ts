// Auto-pause (M8): three counted failures in a row pause a workflow (paused: failing) for its
// enablements and its org switch alike, until an admin resumes it. Tested end to end: runs
// fanned out from new messages and executed on the fake AI Gateway, then a next message that
// starts a run or doesn't.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startReconnect } from "@/features/connections/server";
import { getBalance, grantCredits, recordUsage } from "@/features/credits/server";
import {
  enable,
  getVisibleWorkflow,
  getWorkflow,
  publishWorkflow,
  resumeWorkflow,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { executeRun, failCrashedRun, getRun, pausingRuns, startTriggeredRuns } from "../server";
import { INTERNAL_ERROR_MESSAGE } from "../types";
import { extractWith, pricingQuestion, recordedBackoff, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

// One extract step on `fast`: a run is one model call, which the test makes fail or answer.
const quoteSpec = (overrides: Record<string, unknown> = {}) =>
  threadSpec({ id: "quotes", steps: [extractWith()], ...overrides });

type Inbox = Awaited<ReturnType<typeof connectGoogle>>;

// Org A, funded: a member workflow published to the member, and switched on by `who` for their
// own inbox (the admin's, for a test that reads the runs back: only a run's owner may).
async function workflowOn(who: "member" | "admin" = "member") {
  const { orgA } = await seedTwoOrgs({ credits: FUNDED_CREDITS });
  const { admin, member } = orgA;
  // Saving checks the admin's own Gmail.
  const adminInbox = await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email);
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Quotes", quoteSpec(), ["sales"]);
  await enable((who === "member" ? member : admin).ctx, workflowId);
  const inbox = who === "member" ? memberInbox : adminInbox;
  return { admin, member, system: systemCtx(orgA.id), inbox, workflowId };
}

// A new message on the inbox, fanned out: the IDs of the runs it started.
async function arrives(system: Ctx, inbox: Inbox): Promise<string[]> {
  const message = inbox.mailbox.add(pricingQuestion({ at: new Date() }));
  const { runIds } = await startTriggeredRuns(system, {
    orgId: system.orgId,
    connectionId: inbox.id,
    sourceRef: message.id,
    occurredAt: new Date().toISOString(),
    labelIds: ["INBOX"],
  });
  return runIds;
}

// How the model answers the run's one extract step.
const ANSWERS = {
  // The gateway fails every attempt, so the step and the run fail.
  fails: () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fakeAiGateway.fail("language", { status: 503 });
    }
  },
  succeeds: () => {
    fakeAiGateway.object({ quantity: 30, city: "Leeds", deadline: "Friday" });
  },
  // Nothing is asked of the model.
  none: () => undefined,
};

// A message arrives and its one run executes, the model answering as `answer` says.
async function runOnce(system: Ctx, inbox: Inbox, answer: keyof typeof ANSWERS) {
  const runId = (await arrives(system, inbox)).at(0);
  if (runId === undefined) throw new Error("no run started");
  ANSWERS[answer]();
  const { status } = await executeRun(system, runId, undefined, recordedBackoff());
  return { runId, status };
}

async function failTimes(system: Ctx, inbox: Inbox, times: number): Promise<string[]> {
  const runIds: string[] = [];
  for (let n = 0; n < times; n += 1) {
    const { runId, status } = await runOnce(system, inbox, "fails");
    expect(status).toBe("failed");
    runIds.push(runId);
  }
  return runIds;
}

describe("three failed runs in a row", () => {
  it("pause the workflow: the next message starts no run, and the member's switch stays on", async () => {
    const { admin, member, system, inbox, workflowId } = await workflowOn();

    const failed = await failTimes(system, inbox, 3);

    expect(await arrives(system, inbox)).toEqual([]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "on",
      pausedReason: null,
      pauses: ["failures"],
    });
    // The three runs that paused it, newest first.
    expect((await getWorkflow(admin.ctx, workflowId)).failurePause).toEqual({
      pausedAt: expect.any(Date) as Date,
      runIds: failed.toReversed(),
    });
  });

  it("don't pause it after two", async () => {
    const { member, system, inbox, workflowId } = await workflowOn();

    await failTimes(system, inbox, 2);

    expect(await arrives(system, inbox)).toHaveLength(1);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch?.pauses).toEqual([]);
  });

  it("are counted again from zero after a run that succeeds", async () => {
    const { system, inbox } = await workflowOn();

    await failTimes(system, inbox, 2);
    expect((await runOnce(system, inbox, "succeeds")).status).toBe("succeeded");
    await failTimes(system, inbox, 2);

    expect(await arrives(system, inbox)).toHaveLength(1);
  });

  it("pause an org workflow's switch too", async () => {
    const { orgA } = await seedTwoOrgs({ credits: FUNDED_CREDITS });
    const { admin } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
    const { workflowId } = await publishTo(
      admin.ctx,
      "Shared quotes",
      quoteSpec({ id: "shared-quotes", credentials: "org" }),
      [],
    );
    await switchWorkflowOn(admin.ctx, workflowId, support.id);
    const system = systemCtx(orgA.id);

    await failTimes(system, support, 3);

    expect(await arrives(system, support)).toEqual([]);
    expect((await getWorkflow(admin.ctx, workflowId)).switch?.pauses).toEqual(["failures"]);
  });

  it("count a run whose job crashed", async () => {
    const { system, inbox } = await workflowOn();

    await failTimes(system, inbox, 2);
    const [crashed] = await arrives(system, inbox);
    await failCrashedRun(system, crashed);

    expect(await arrives(system, inbox)).toEqual([]);
  });
});

describe("the runs that paused it, as an admin's Health check lists them", () => {
  it("say when, whose inbox, the failed step and the error, link each run, and say nothing of the message", async () => {
    const { admin, member, system, inbox, workflowId } = await workflowOn();
    await failTimes(system, inbox, 2);
    const [crashed] = await arrives(system, inbox);
    await failCrashedRun(system, crashed);
    const runIds = (await getWorkflow(admin.ctx, workflowId)).failurePause?.runIds ?? [];

    const listed = await pausingRuns(admin.ctx, runIds);

    expect(listed).toEqual([
      {
        runId: crashed,
        href: `/runs/${crashed}`,
        finishedAt: expect.any(Date) as Date,
        inbox: `${member.email}'s inbox`,
        failedStep: null,
        error: INTERNAL_ERROR_MESSAGE,
      },
      ...runIds.slice(1).map((runId) => ({
        runId,
        href: `/runs/${runId}`,
        finishedAt: expect.any(Date) as Date,
        inbox: `${member.email}'s inbox`,
        failedStep: "details",
        error: expect.stringContaining("503") as string,
      })),
    ]);
    const shown = JSON.stringify(listed);
    for (const content of ["Quote for 30 oak chairs", "Leeds", "ada@customer.test"]) {
      expect(shown).not.toContain(content);
    }
  });

  it("are for admins only", async () => {
    const { member, system, inbox } = await workflowOn();
    const failed = await failTimes(system, inbox, 3);

    await expect(pausingRuns(member.ctx, failed)).rejects.toThrow(ForbiddenError);
  });
});

describe("failures that don't count", () => {
  it("leave out a token Google refused mid-run, which neither counts nor resets the count", async () => {
    const { admin, system, inbox, workflowId } = await workflowOn("admin");

    await failTimes(system, inbox, 2);
    fakeNango.revokeAccess(inbox.nangoConnectionId);
    for (let n = 0; n < 3; n += 1) {
      const { runId, status } = await runOnce(system, inbox, "none");
      expect(status).toBe("failed");
      expect((await getRun(admin.ctx, runId)).steps).toMatchObject([
        { status: "failed", attempts: 1, errorCode: "needs_reconnect" },
      ]);
    }
    const { token } = await startReconnect(admin.ctx, inbox.id);
    await deliver(fakeNango.completeReconnect(token));
    // Still two in a row: a third pauses it.
    await failTimes(system, inbox, 1);

    expect(await arrives(system, inbox)).toEqual([]);
    expect((await getWorkflow(admin.ctx, workflowId)).switch?.pauses).toEqual(["failures"]);
  });

  it("leave out running out of credits mid-run", async () => {
    const { admin, system, inbox } = await workflowOn("admin");

    for (let n = 0; n < 3; n += 1) {
      const [runId] = await arrives(system, inbox);
      // The balance is spent between the fan-out and the run's model call.
      await recordUsage(system, {
        role: "fast",
        modelId: "openai/x",
        costUsd: 1000,
        outcome: "succeeded",
      });
      expect((await executeRun(system, runId, undefined, recordedBackoff())).status).toBe("failed");
      expect((await getRun(admin.ctx, runId)).steps).toMatchObject([
        { errorCode: "out_of_credits" },
      ]);
      await grantCredits(system, FUNDED_CREDITS - (await getBalance(system)));
    }

    expect(await arrives(system, inbox)).toHaveLength(1);
  });
});

describe("resuming", () => {
  it("lets the next message start a run, and counts from zero again", async () => {
    const { admin, system, inbox, workflowId } = await workflowOn();
    await failTimes(system, inbox, 3);
    expect((await getWorkflow(admin.ctx, workflowId)).failurePause).not.toBeNull();

    await resumeWorkflow(admin.ctx, workflowId);

    expect((await getWorkflow(admin.ctx, workflowId)).failurePause).toBeNull();
    // The three failures before the resume no longer count: two more don't pause it.
    await failTimes(system, inbox, 2);
    expect(await arrives(system, inbox)).toHaveLength(1);
  });

  it("is for admins only", async () => {
    const { member, system, inbox, workflowId } = await workflowOn();
    await failTimes(system, inbox, 3);

    await expect(resumeWorkflow(member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
    expect(await arrives(system, inbox)).toEqual([]);
  });
});

describe("publishing a new version", () => {
  it("keeps the pause until an admin resumes it", async () => {
    const { admin, member, system, inbox, workflowId } = await workflowOn();
    await failTimes(system, inbox, 3);

    await publishWorkflow(admin.ctx, workflowId);

    expect(await arrives(system, inbox)).toEqual([]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch?.pauses).toEqual(["failures"]);
  });

  it("counts from zero again for the new version", async () => {
    const { admin, system, inbox, workflowId } = await workflowOn();
    await failTimes(system, inbox, 2);

    await publishWorkflow(admin.ctx, workflowId);
    await failTimes(system, inbox, 2);

    expect(await arrives(system, inbox)).toHaveLength(1);
  });
});
