import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { enable } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import * as server from "../server";

// Org B's member has a conversation with one turn, and its admin an empty one: org A must
// neither see nor change either.
async function seedOrgB({ orgB }: TwoOrgs) {
  await fundOrg(orgB.id);
  const member = orgB.member.ctx;
  const conversation = await server.startConversation(member);
  fakeAiGateway.reply({ text: "Hello from org B." });
  await readTurn(await server.streamTurn(member, conversation.id, "Hello"));
  const empty = await server.startConversation(orgB.admin.ctx);
  return {
    conversationId: conversation.id,
    emptyId: empty.id,
    before: await server.getConversation(member, conversation.id),
    requests: fakeAiGateway.requests().length,
  };
}

const people = ({ orgA }: TwoOrgs) => [orgA.admin.ctx, orgA.member.ctx];

// Org B's member has a workflow on for their own inbox, and a conversation in which the agent
// offered to run it on a message there.
async function seedOrgBPendingRun({ orgB }: TwoOrgs) {
  await fundOrg(orgB.id);
  const { admin, member } = orgB;
  await connectGoogle(admin.ctx, admin.email);
  const inbox = await connectGoogle(member.ctx, member.email);
  const message = inbox.mailbox.add({ from: "ada@customer.test", subject: "Hi", at: new Date() });
  await tagUsers(admin.ctx, "sales", [member]);
  const spec = {
    specVersion: 1,
    id: "reads",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "message",
        type: "tool",
        action: "google-mail.read-message",
        input: { messageId: { from: "trigger.messageId" } },
      },
    ],
    autonomy: { rung: 3 },
  };
  const { workflowId } = await publishTo(admin.ctx, "Reads", spec, ["sales"]);
  await enable(member.ctx, workflowId);
  const { id } = await server.startConversation(member.ctx);
  fakeAiGateway.reply({
    toolCalls: [{ name: "propose_run", input: { workflowId, messageId: message.id } }],
  });
  fakeAiGateway.reply({ text: "Press Run." });
  await readTurn(await server.streamTurn(member.ctx, id, "Run Reads on Ada's email"));
  const [pending] = (await server.getConversation(member.ctx, id)).pendingRuns;
  return { conversationId: id, pendingRunId: pending.id };
}

export const isolationCases = defineIsolationCases(server, {
  runPendingRun: async (orgs) => {
    const b = await seedOrgBPendingRun(orgs);

    for (const ctx of people(orgs)) {
      await expect(server.runPendingRun(ctx, b.pendingRunId)).rejects.toThrow(NotFoundError);
    }
    expect(fakeInngest.sent("runtime/run.requested")).toEqual([]);
    const [pending] = (await server.getConversation(orgs.orgB.member.ctx, b.conversationId))
      .pendingRuns;
    expect(pending.run).toBeNull();
  },

  startConversation: async (orgs) => {
    const orgB = await seedOrgB(orgs);

    // Org B's admin's empty conversation isn't reused for anyone in org A.
    for (const ctx of people(orgs)) {
      expect((await server.startConversation(ctx)).id).not.toBe(orgB.emptyId);
    }
    expect(await server.listConversations(orgs.orgB.admin.ctx)).toEqual([
      expect.objectContaining({ id: orgB.emptyId }),
    ]);
  },

  listConversations: async (orgs) => {
    await seedOrgB(orgs);
    const own = await server.startConversation(orgs.orgA.member.ctx);

    expect((await server.listConversations(orgs.orgA.member.ctx)).map((c) => c.id)).toEqual([
      own.id,
    ]);
    expect(await server.listConversations(orgs.orgA.admin.ctx)).toEqual([]);
  },

  getConversation: async (orgs) => {
    const orgB = await seedOrgB(orgs);

    for (const ctx of people(orgs)) {
      await expect(server.getConversation(ctx, orgB.conversationId)).rejects.toThrow(NotFoundError);
    }
  },

  deleteConversation: async (orgs) => {
    const orgB = await seedOrgB(orgs);

    for (const ctx of people(orgs)) {
      await expect(server.deleteConversation(ctx, orgB.conversationId)).rejects.toThrow(
        NotFoundError,
      );
    }
    expect(await server.getConversation(orgs.orgB.member.ctx, orgB.conversationId)).toEqual(
      orgB.before,
    );
  },

  streamTurn: async (orgs) => {
    const orgB = await seedOrgB(orgs);
    await fundOrg(orgs.orgA.id);

    for (const ctx of people(orgs)) {
      await expect(server.streamTurn(ctx, orgB.conversationId, "Hi")).rejects.toThrow(
        NotFoundError,
      );
    }
    expect(fakeAiGateway.requests()).toHaveLength(orgB.requests);
    expect(await server.getConversation(orgs.orgB.member.ctx, orgB.conversationId)).toEqual(
      orgB.before,
    );
  },
});
