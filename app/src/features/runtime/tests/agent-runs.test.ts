// Running a person's own workflow on a message they picked, from Ask Mycel (M9, #182): the
// latest version on their own inbox under their enablement, started by the agent, refused in
// plain words whenever the trigger's fan-out wouldn't start it, and one at a time per message.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listReviews } from "@/features/reviews/server";
import {
  disable,
  enable,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ConflictError, NotFoundError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  agentRunDetails,
  checkRunFromAgent,
  executeRun,
  listRuns,
  startRunFromAgent,
} from "../server";
import { RunsTable } from "../ui";
import { pricingQuestion, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

const readMessage = {
  id: "message",
  type: "tool",
  action: "google-mail.read-message",
  input: { messageId: { from: "trigger.messageId" } },
};
const draftReply = {
  id: "draft",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
};
const approve = { id: "approve", type: "approval", channel: "gmail_drafts" };

// One read step: a run needs no model.
const readSpec = (overrides: Record<string, unknown> = {}) =>
  threadSpec({ id: "reads", steps: [readMessage], ...overrides });
const replySpec = () => threadSpec({ id: "replies", steps: [draftReply, approve] });

const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered to Leeds next week.";

// Org A: the member has `sales`, a workflow published to it is on for their own inbox, which
// holds one pricing question; the admin has their own inbox, with a message of their own.
async function switchedOn(spec = readSpec(), credits = FUNDED_CREDITS) {
  const { orgA } = await seedTwoOrgs({ credits });
  const { admin, member } = orgA;
  const adminInbox = await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email);
  const message = memberInbox.mailbox.add(pricingQuestion());
  const adminMessage = adminInbox.mailbox.add(pricingQuestion({ subject: "Admin's own" }));
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Reads", spec, ["sales"]);
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, memberInbox, adminInbox, message, adminMessage, workflowId };
}

async function runsOf(ctx: Ctx) {
  return (await listRuns(ctx, {})).runs;
}

const requested = () => fakeInngest.sent("runtime/run.requested");

describe("startRunFromAgent", () => {
  it("runs the latest version on the person's own inbox, started by the agent", async () => {
    const { orgA, member, memberInbox, message, workflowId } = await switchedOn();

    const { runId } = await startRunFromAgent(member.ctx, workflowId, message.id);

    expect(await runsOf(member.ctx)).toEqual([
      expect.objectContaining({
        id: runId,
        workflowId,
        connectionId: memberInbox.id,
        ownerScope: "member",
        startedBy: "agent",
        status: "running",
        message: expect.objectContaining({ sourceRef: message.id }) as unknown,
      }),
    ]);
    expect(requested().map((event) => event.data)).toEqual([
      { orgId: orgA.id, runId, connectionId: memberInbox.id },
    ]);
  });

  it("refuses a workflow the person hasn't switched on, though a colleague has", async () => {
    const { admin, member, message, workflowId } = await switchedOn();
    await enable(admin.ctx, workflowId);
    await disable(member.ctx, workflowId);

    await expect(startRunFromAgent(member.ctx, workflowId, message.id)).rejects.toThrow(
      new ConflictError("You haven't switched Reads on. Switch it on from Workflows first."),
    );
    expect(await runsOf(member.ctx)).toEqual([]);
    expect(requested()).toEqual([]);
  });

  it("refuses an org workflow: it runs on a shared inbox, not the person's own", async () => {
    const { admin, member, message } = await switchedOn();
    const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
    const shared = await publishTo(
      admin.ctx,
      "Shared reads",
      readSpec({ id: "shared-reads", credentials: "org" }),
      ["sales"],
    );
    await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);

    for (const ctx of [member.ctx, admin.ctx]) {
      await expect(startRunFromAgent(ctx, shared.workflowId, message.id)).rejects.toThrow(
        new ValidationError(
          "Shared reads runs on a shared inbox, not on your own mail, so Ask Mycel can't run it.",
        ),
      );
    }
    expect(requested()).toEqual([]);
  });

  it("refuses a workflow the person can't see", async () => {
    const { admin, member, message } = await switchedOn();
    await tagUsers(admin.ctx, "finance", [admin]);
    const hidden = await publishTo(admin.ctx, "Hidden", readSpec({ id: "hidden" }), ["finance"]);

    await expect(startRunFromAgent(member.ctx, hidden.workflowId, message.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses a message that isn't in the person's own mail", async () => {
    const { member, adminMessage, workflowId } = await switchedOn();

    for (const ref of [adminMessage.id, "no-such-message"]) {
      await expect(startRunFromAgent(member.ctx, workflowId, ref)).rejects.toThrow(
        new ValidationError("That message isn't in your mail."),
      );
    }
    expect(requested()).toEqual([]);
  });

  it("refuses while the person's enablement waits for their OK for a riskier version", async () => {
    const { admin, member, message, workflowId } = await switchedOn();
    const riskier = readSpec({ steps: [readMessage, draftReply], visibility: { tags: ["sales"] } });
    await saveWorkflow(admin.ctx, { workflowId, name: "Reads", spec: riskier });
    await publishWorkflow(admin.ctx, workflowId);

    await expect(startRunFromAgent(member.ctx, workflowId, message.id)).rejects.toThrow(
      new ConflictError(
        "Reads is paused: needs your OK for a riskier version. Switch it on again first.",
      ),
    );
  });

  it("refuses while the company is out of credits, as fan-out starts nothing", async () => {
    const { member, message, workflowId } = await switchedOn(readSpec(), 0);

    await expect(startRunFromAgent(member.ctx, workflowId, message.id)).rejects.toThrow(
      OutOfCreditsError,
    );
    expect(await runsOf(member.ctx)).toEqual([]);
    expect(requested()).toEqual([]);
  });

  it("refuses an inbox Google refused, until it's reconnected", async () => {
    const { member, memberInbox, message, workflowId } = await switchedOn();
    await deliver(fakeNango.authWebhook(memberInbox.nangoConnectionId, "refresh", false));

    await expect(startRunFromAgent(member.ctx, workflowId, message.id)).rejects.toThrow(
      new ConflictError("Google refused access to your inbox. Reconnect Google first."),
    );
  });

  it("starts one run per message while one is under way: a double click drafts one reply", async () => {
    const { orgA, member, message, workflowId } = await switchedOn();

    const first = await startRunFromAgent(member.ctx, workflowId, message.id);
    const [again] = await Promise.allSettled([
      startRunFromAgent(member.ctx, workflowId, message.id),
    ]);

    expect(again).toMatchObject({
      status: "rejected",
      reason: new ConflictError("Reads is already running on that message."),
    });
    expect((await runsOf(member.ctx)).map((run) => run.id)).toEqual([first.runId]);
    expect(requested()).toHaveLength(1);

    // Once it has finished, the message may be run again.
    await executeRun(systemCtx(orgA.id), first.runId);
    const second = await startRunFromAgent(member.ctx, workflowId, message.id);
    expect(second.runId).not.toBe(first.runId);
  });

  it("starts one run however many clicks arrive at once", async () => {
    const { member, message, workflowId } = await switchedOn();

    const clicks = await Promise.allSettled(
      [1, 2, 3].map(() => startRunFromAgent(member.ctx, workflowId, message.id)),
    );

    expect(clicks.filter((click) => click.status === "fulfilled")).toHaveLength(1);
    expect(await runsOf(member.ctx)).toHaveLength(1);
    expect(requested()).toHaveLength(1);
  });
});

describe("checkRunFromAgent", () => {
  it("says what would run, and starts nothing", async () => {
    const { member, memberInbox, message, workflowId } = await switchedOn();

    expect(await checkRunFromAgent(member.ctx, workflowId, message.id)).toEqual({
      workflowId,
      workflowName: "Reads",
      connectionId: memberInbox.id,
      sourceRef: message.id,
    });
    expect(await runsOf(member.ctx)).toEqual([]);
    expect(requested()).toEqual([]);
  });
});

describe("an agent run in the interpreter", () => {
  it("runs to the end with no org switch, and its draft waits on the person's Reviews page", async () => {
    const { orgA, member, memberInbox, message, workflowId } = await switchedOn(replySpec());
    const { runId } = await startRunFromAgent(member.ctx, workflowId, message.id);
    fakeAiGateway.text(REPLY, { costUsd: 0.003 });

    expect(await executeRun(systemCtx(orgA.id), runId)).toEqual({ status: "succeeded" });

    expect(memberInbox.mailbox.drafts()).toHaveLength(1);
    expect(await listReviews(member.ctx)).toEqual([
      expect.objectContaining({ kind: "approval", workflowId }),
    ]);
  });

  it("stops before its next step once the person switches the workflow off", async () => {
    const { orgA, member, message, workflowId } = await switchedOn();
    const { runId } = await startRunFromAgent(member.ctx, workflowId, message.id);
    await disable(member.ctx, workflowId);

    expect(await executeRun(systemCtx(orgA.id), runId)).toEqual({ status: "cancelled" });
  });
});

describe("agentRunDetails", () => {
  it("gives the message's sender, subject and date from Gmail, and the run's outcome", async () => {
    const { orgA, member, memberInbox, message, workflowId } = await switchedOn();
    const { runId } = await startRunFromAgent(member.ctx, workflowId, message.id);
    await executeRun(systemCtx(orgA.id), runId);
    const pending = { connectionId: memberInbox.id, sourceRef: message.id };

    expect(
      await agentRunDetails(member.ctx, [
        { ...pending, runId },
        { ...pending, runId: null },
      ]),
    ).toEqual([
      {
        message: {
          from: "ada@customer.test",
          subject: "Quote for 30 oak chairs",
          receivedAt: expect.any(Date) as Date,
        },
        run: { id: runId, status: "succeeded" },
      },
      {
        message: expect.objectContaining({ subject: "Quote for 30 oak chairs" }) as unknown,
        run: null,
      },
    ]);
  });

  it("gives nothing of a colleague's inbox, or of a message Gmail no longer has", async () => {
    const { admin, member, memberInbox, message, workflowId } = await switchedOn();
    const { runId } = await startRunFromAgent(member.ctx, workflowId, message.id);

    expect(
      await agentRunDetails(admin.ctx, [
        { connectionId: memberInbox.id, sourceRef: message.id, runId },
      ]),
    ).toEqual([{ message: null, run: null }]);
    memberInbox.mailbox.delete(message.id);
    expect(
      await agentRunDetails(member.ctx, [
        { connectionId: memberInbox.id, sourceRef: message.id, runId: null },
      ]),
    ).toEqual([{ message: null, run: null }]);
  });
});

describe("the Runs page", () => {
  it("marks a run started from Ask Mycel", async () => {
    const { member, message, workflowId } = await switchedOn();
    await startRunFromAgent(member.ctx, workflowId, message.id);

    const page = renderToStaticMarkup(
      createElement(RunsTable, { runs: await runsOf(member.ctx), showInbox: false }),
    );

    expect(page).toContain("From Ask Mycel");
  });
});
