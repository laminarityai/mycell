import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { saveWorkflow } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";
import { labelSpec } from "./specs";
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

export const isolationCases = defineIsolationCases(server, {
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
