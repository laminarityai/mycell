import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { DAY_MS } from "@/lib/time";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
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

export const isolationCases = defineIsolationCases(server, {
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

  deleteIdleConversations: async (orgs) => {
    const orgB = await seedOrgB(orgs);
    // Long after org B's conversations were last used, org A's job still doesn't reach them.
    const farFuture = new Date(Date.now() + 400 * DAY_MS);

    expect(await server.deleteIdleConversations(systemCtx(orgs.orgA.id), farFuture)).toEqual({
      conversations: 0,
    });

    expect(await server.getConversation(orgs.orgB.member.ctx, orgB.conversationId)).toEqual(
      orgB.before,
    );
    expect(await server.listConversations(orgs.orgB.admin.ctx)).toEqual([
      expect.objectContaining({ id: orgB.emptyId }),
    ]);
  },
});
