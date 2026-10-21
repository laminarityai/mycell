import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { getWorkflow, saveWorkflow } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";
import { proposeInTurn } from "./proposal-helpers";
import { draftSpec, labelSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

// Org B has a workflow and a conversation about it with one turn, so every case can check
// org B is left exactly as it was.
async function seedOrgB({ orgB }: TwoOrgs) {
  const admin = orgB.admin.ctx;
  await fundOrg(orgB.id);
  await connectGmail(admin, orgB.admin.email);
  const workflow = await saveWorkflow(admin, { name: "B", spec: labelSpec() });
  const conversation = await server.startConversation(admin, { workflowId: workflow.id });
  fakeAiGateway.reply({ text: "Hello from org B." });
  await readTurn(await server.streamTurn(admin, conversation.id, "Hello"));
  return {
    workflowId: workflow.id,
    conversationId: conversation.id,
    before: await server.getConversation(admin, conversation.id),
    requests: fakeAiGateway.requests().length,
  };
}

// Org B's conversation about its workflow holds a proposal waiting for a decision.
async function seedOrgBProposal(orgs: TwoOrgs) {
  const orgB = await seedOrgB(orgs);
  const admin = orgs.orgB.admin.ctx;
  await proposeInTurn(admin, orgB.conversationId, [draftSpec({ id: "label-pricing" })]);
  const proposal = (await server.listProposals(admin, orgB.conversationId)).at(0);
  if (proposal === undefined) throw new Error("org B's proposal wasn't stored");
  return { ...orgB, proposal, workflowBefore: await getWorkflow(admin, orgB.workflowId) };
}

export const isolationCases = defineIsolationCases(server, {
  listProposals: async (orgs) => {
    const orgB = await seedOrgBProposal(orgs);

    await expect(server.listProposals(orgs.orgA.admin.ctx, orgB.conversationId)).rejects.toThrow(
      NotFoundError,
    );
  },

  acceptProposal: async (orgs) => {
    const orgB = await seedOrgBProposal(orgs);

    await expect(server.acceptProposal(orgs.orgA.admin.ctx, orgB.proposal.id)).rejects.toThrow(
      NotFoundError,
    );
    const admin = orgs.orgB.admin.ctx;
    expect(await getWorkflow(admin, orgB.workflowId)).toEqual(orgB.workflowBefore);
    expect(await server.listProposals(admin, orgB.conversationId)).toEqual([orgB.proposal]);
  },

  rejectProposal: async (orgs) => {
    const orgB = await seedOrgBProposal(orgs);

    await expect(server.rejectProposal(orgs.orgA.admin.ctx, orgB.proposal.id)).rejects.toThrow(
      NotFoundError,
    );
    const admin = orgs.orgB.admin.ctx;
    expect(await server.listProposals(admin, orgB.conversationId)).toEqual([orgB.proposal]);
  },

  startConversation: async (orgs) => {
    const orgB = await seedOrgB(orgs);
    const admin = orgs.orgA.admin.ctx;

    await expect(server.startConversation(admin, { workflowId: orgB.workflowId })).rejects.toThrow(
      NotFoundError,
    );
    await server.startConversation(admin, {});

    expect(await server.listConversations(orgs.orgB.admin.ctx)).toEqual([
      expect.objectContaining({ id: orgB.conversationId }),
    ]);
  },

  listConversations: async (orgs) => {
    await seedOrgB(orgs);
    const own = await server.startConversation(orgs.orgA.admin.ctx, {});

    expect((await server.listConversations(orgs.orgA.admin.ctx)).map((c) => c.id)).toEqual([
      own.id,
    ]);
  },

  getConversation: async (orgs) => {
    const orgB = await seedOrgB(orgs);

    await expect(server.getConversation(orgs.orgA.admin.ctx, orgB.conversationId)).rejects.toThrow(
      NotFoundError,
    );
  },

  streamTurn: async (orgs) => {
    const orgB = await seedOrgB(orgs);
    const admin = orgs.orgA.admin.ctx;
    await fundOrg(orgs.orgA.id);

    await expect(server.streamTurn(admin, orgB.conversationId, "Hi")).rejects.toThrow(
      NotFoundError,
    );
    expect(fakeAiGateway.requests()).toHaveLength(orgB.requests);

    // The agent's tools run as the admin: org B's workflow is "not found" to them too.
    const own = await server.startConversation(admin, {});
    fakeAiGateway.reply({
      toolCalls: [{ name: "get_workflow", input: { workflowId: orgB.workflowId } }],
    });
    fakeAiGateway.reply({ text: "I can't find it." });
    await readTurn(await server.streamTurn(admin, own.id, "Show me workflow B"));
    const reply = (await server.getConversation(admin, own.id)).messages.at(-1);
    expect(reply?.parts.at(0)).toMatchObject({
      type: "tool",
      isError: true,
      output: "That workflow doesn't exist.",
    });
    expect(JSON.stringify(fakeAiGateway.requests().at(-1)?.body)).not.toContain("label-pricing");

    expect(await server.getConversation(orgs.orgB.admin.ctx, orgB.conversationId)).toEqual(
      orgB.before,
    );
  },
});
