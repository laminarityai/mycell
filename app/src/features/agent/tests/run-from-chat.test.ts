// Running one of the person's workflows on a message they pick, from Ask Mycel (#182): the agent
// only proposes, the person presses Run, and the run's drafts wait on Reviews like any other.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { FUNDED_CREDITS, seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listReviews } from "@/features/reviews/server";
import { executeRun, listRuns } from "@/features/runtime/server";
import { disable, enable } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { readTurn } from "@/testing/streamed-turn";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { getConversation, runPendingRun, startConversation, streamTurn } from "../server";

beforeEach(resetDatabase);

const SUBJECT = "Quote for 30 oak chairs";
const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered to Leeds next week.";

// Drafts a reply that waits for the person's approval.
const replySpec = {
  specVersion: 1,
  id: "pricing-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
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
  autonomy: { rung: 3 },
};

// Org A: the member has the reply workflow on for their own inbox, which holds a pricing
// question that arrived before they switched it on.
async function memberWithWorkflow() {
  const { orgA } = await seedTwoOrgs({ credits: FUNDED_CREDITS });
  const { admin, member } = orgA;
  const adminInbox = await connectGoogle(admin.ctx, admin.email);
  const colleagueMessage = adminInbox.mailbox.add({
    from: "bob@customer.test",
    subject: "Not the member's",
    at: new Date(),
  });
  const inbox = await connectGoogle(member.ctx, member.email);
  const message = inbox.mailbox.add({
    from: "ada@customer.test",
    subject: SUBJECT,
    text: "Hello, what would 30 oak chairs cost delivered to Leeds?",
    at: new Date(Date.now() - 60_000),
  });
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Pricing replies", replySpec, ["sales"]);
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, inbox, message, colleagueMessage, workflowId };
}

/** One turn in which the agent proposes running `workflowId` on `messageId`. */
async function propose(ctx: Ctx, workflowId: string, messageId: string) {
  const { id } = await startConversation(ctx);
  fakeAiGateway.reply({ toolCalls: [{ name: "propose_run", input: { workflowId, messageId } }] });
  fakeAiGateway.reply({ text: "Press Run to draft the reply." });
  await readTurn(await streamTurn(ctx, id, "Draft the usual reply to Ada's email"));
  return { conversationId: id, conversation: await getConversation(ctx, id) };
}

const requested = () => fakeInngest.sent("runtime/run.requested");

describe("propose_run", () => {
  it("shows what would run, waiting for the person, and starts nothing", async () => {
    const { member, inbox, message, workflowId } = await memberWithWorkflow();

    const { conversation } = await propose(member.ctx, workflowId, message.id);

    expect(conversation.pendingRuns).toEqual([
      {
        id: expect.any(String) as string,
        workflowId,
        workflowName: "Pricing replies",
        message: {
          from: "ada@customer.test",
          subject: SUBJECT,
          receivedAt: expect.any(Date) as Date,
        },
        run: null,
        createdAt: expect.any(Date) as Date,
      },
    ]);
    expect((await listRuns(member.ctx, {})).runs).toEqual([]);
    expect(requested()).toEqual([]);
    // The conversation keeps the pending run's ID, never the message's sender or subject: the
    // page fetches them from Gmail (invariant 8).
    const stored = JSON.stringify(conversation.messages);
    expect(stored).toContain(conversation.pendingRuns[0].id);
    expect(stored).not.toContain(SUBJECT);
    expect(stored).not.toContain("ada@customer.test");
    // The model is told the person decides, not that anything ran.
    const sent = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(sent).toContain("Run");
    expect(inbox.mailbox.drafts()).toEqual([]);
  });

  it("refuses in plain words, recording nothing", async () => {
    const { member, message, colleagueMessage, workflowId } = await memberWithWorkflow();
    const refusals = [
      { workflowId, messageId: colleagueMessage.id, why: "That message isn't in your mail." },
      { workflowId: "missing", messageId: message.id, why: "That workflow doesn't exist." },
    ];

    for (const refusal of refusals) {
      const { conversation } = await propose(member.ctx, refusal.workflowId, refusal.messageId);
      expect(conversation.pendingRuns).toEqual([]);
      expect(conversation.messages.at(-1)?.parts).toContainEqual(
        expect.objectContaining({
          type: "tool",
          toolName: "propose_run",
          output: { proposed: false, why: refusal.why },
        }),
      );
    }
    await disable(member.ctx, workflowId);
    const { conversation } = await propose(member.ctx, workflowId, message.id);
    expect(conversation.messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({
        output: {
          proposed: false,
          why: "You haven't switched Pricing replies on. Switch it on from Workflows first.",
        },
      }),
    );
    expect(requested()).toEqual([]);
  });

  it("refuses while a run of the workflow on that message is under way", async () => {
    const { member, message, workflowId } = await memberWithWorkflow();
    const first = await propose(member.ctx, workflowId, message.id);
    await runPendingRun(member.ctx, first.conversation.pendingRuns[0].id);

    const { conversation } = await propose(member.ctx, workflowId, message.id);

    expect(conversation.pendingRuns).toEqual([]);
    expect(conversation.messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({
        output: { proposed: false, why: "Pricing replies is already running on that message." },
      }),
    );
  });
});

describe("a conversation's pending runs", () => {
  it("are read with the same queries for 1 offered run as for 3", async () => {
    const { member, inbox, message, workflowId } = await memberWithWorkflow();
    const one = await propose(member.ctx, workflowId, message.id);
    const { conversationId } = await propose(member.ctx, workflowId, message.id);
    const other = inbox.mailbox.add({ from: "bo@customer.test", subject: "Two", at: new Date() });
    for (const messageId of [other.id, message.id]) {
      fakeAiGateway.reply({
        toolCalls: [{ name: "propose_run", input: { workflowId, messageId } }],
      });
      fakeAiGateway.reply({ text: "Press Run." });
      await readTurn(await streamTurn(member.ctx, conversationId, "And this one"));
    }
    await runPendingRun(member.ctx, one.conversation.pendingRuns[0].id);
    const read = (id: string) => countQueries(() => getConversation(member.ctx, id));
    const several = await getConversation(member.ctx, conversationId);
    await runPendingRun(member.ctx, several.pendingRuns[1].id);

    expect((await getConversation(member.ctx, conversationId)).pendingRuns).toHaveLength(3);
    expect((await read(conversationId)).queries).toBe((await read(one.conversationId)).queries);
  });
});

describe("pressing Run", () => {
  it("starts one run on the person's own inbox, and the chat shows how it ended", async () => {
    const { orgA, member, inbox, message, workflowId } = await memberWithWorkflow();
    const { conversationId, conversation } = await propose(member.ctx, workflowId, message.id);
    const pendingId = conversation.pendingRuns[0].id;

    const { runId } = await runPendingRun(member.ctx, pendingId);

    expect((await listRuns(member.ctx, {})).runs).toEqual([
      expect.objectContaining({
        id: runId,
        workflowId,
        connectionId: inbox.id,
        startedBy: "agent",
      }),
    ]);
    expect((await getConversation(member.ctx, conversationId)).pendingRuns[0].run).toEqual({
      id: runId,
      status: "running",
    });

    fakeAiGateway.text(REPLY, { costUsd: 0.003 });
    await executeRun(systemCtx(orgA.id), runId);

    expect((await getConversation(member.ctx, conversationId)).pendingRuns[0].run).toEqual({
      id: runId,
      status: "succeeded",
    });
    // The draft waits on the person's Reviews page, like any run's.
    expect(await listReviews(member.ctx)).toEqual([
      expect.objectContaining({ kind: "approval", workflowId }),
    ]);
  });

  it("starts nothing more on a second click", async () => {
    const { member, message, workflowId } = await memberWithWorkflow();
    const { conversation } = await propose(member.ctx, workflowId, message.id);
    const pendingId = conversation.pendingRuns[0].id;

    const first = await runPendingRun(member.ctx, pendingId);
    const second = await runPendingRun(member.ctx, pendingId);

    expect(second).toEqual(first);
    expect((await listRuns(member.ctx, {})).runs).toHaveLength(1);
    expect(requested()).toHaveLength(1);
  });

  it("checks everything again: switched off since, it's refused", async () => {
    const { member, message, workflowId } = await memberWithWorkflow();
    const { conversation } = await propose(member.ctx, workflowId, message.id);
    await disable(member.ctx, workflowId);

    await expect(runPendingRun(member.ctx, conversation.pendingRuns[0].id)).rejects.toThrow(
      ConflictError,
    );
    expect((await listRuns(member.ctx, {})).runs).toEqual([]);
  });

  it("is the person's own: a colleague, an admin included, can't press it", async () => {
    const { orgA, member, message, workflowId } = await memberWithWorkflow();
    const { conversation } = await propose(member.ctx, workflowId, message.id);
    const pendingId = conversation.pendingRuns[0].id;

    for (const ctx of [orgA.admin.ctx, systemCtx(orgA.id)]) {
      await expect(runPendingRun(ctx, pendingId)).rejects.toThrow();
    }
    await expect(runPendingRun(orgA.admin.ctx, pendingId)).rejects.toThrow(NotFoundError);
    expect(requested()).toEqual([]);
  });
});
