import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import { FUNDED_CREDITS, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { switchWorkflowOn } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

// Org B has a workflow and a running run on its admin's inbox.
async function seedOrgBRun({ orgB }: TwoOrgs) {
  const inbox = await connectInbox(orgB.admin.ctx, orgB.admin.email, [pricingQuestion()]);
  const workflowId = await publish(orgB.admin.ctx, threadSpec());
  const { runId } = await server.startRun(
    orgB.admin.ctx,
    workflowId,
    inbox.connectionId,
    inbox.messages[0].id,
  );
  return { connectionId: inbox.connectionId, workflowId, runId };
}

// Org B's admin has a workflow switched on for their own inbox, which holds one message: what
// Ask Mycel would run there.
async function seedOrgBEnabled({ orgB }: TwoOrgs) {
  await grantCredits(systemCtx(orgB.id), FUNDED_CREDITS);
  const inbox = await connectInbox(orgB.admin.ctx, orgB.admin.email, [pricingQuestion()]);
  const workflowId = await publish(orgB.admin.ctx, threadSpec());
  await switchWorkflowOn(orgB.admin.ctx, workflowId, inbox.connectionId);
  return { workflowId, connectionId: inbox.connectionId, messageId: inbox.messages[0].id };
}

const orgAPeople = ({ orgA }: TwoOrgs) => [orgA.admin.ctx, orgA.member.ctx];

export const isolationCases = defineIsolationCases(server, {
  checkRunFromAgent: async (orgs) => {
    const b = await seedOrgBEnabled(orgs);

    for (const ctx of orgAPeople(orgs)) {
      await expect(server.checkRunFromAgent(ctx, b.workflowId, b.messageId)).rejects.toThrow(
        NotFoundError,
      );
    }
    expect(
      await server.checkRunFromAgent(orgs.orgB.admin.ctx, b.workflowId, b.messageId),
    ).toMatchObject({ workflowId: b.workflowId, connectionId: b.connectionId });
  },

  startRunFromAgent: async (orgs) => {
    const b = await seedOrgBEnabled(orgs);

    for (const ctx of orgAPeople(orgs)) {
      await expect(server.startRunFromAgent(ctx, b.workflowId, b.messageId)).rejects.toThrow(
        NotFoundError,
      );
    }
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toEqual([]);
  },

  agentRunDetails: async (orgs) => {
    const b = await seedOrgBEnabled(orgs);
    const { runId } = await server.startRunFromAgent(
      orgs.orgB.admin.ctx,
      b.workflowId,
      b.messageId,
    );
    const offer = { connectionId: b.connectionId, sourceRef: b.messageId, runId };

    for (const ctx of orgAPeople(orgs)) {
      expect(await server.agentRunDetails(ctx, [offer])).toEqual([{ message: null, run: null }]);
    }
    expect(await server.agentRunDetails(orgs.orgB.admin.ctx, [offer])).toEqual([
      {
        message: expect.objectContaining({ subject: "Quote for 30 oak chairs" }) as unknown,
        run: { id: runId, status: "running" },
      },
    ]);
  },

  startRun: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const admin = orgs.orgA.admin.ctx;
    await connectInbox(admin, orgs.orgA.admin.email, []);
    const ownWorkflow = await publish(admin, threadSpec());

    await expect(server.startRun(admin, orgB.workflowId, orgB.connectionId, "m")).rejects.toThrow(
      NotFoundError,
    );
    await expect(server.startRun(admin, ownWorkflow, orgB.connectionId, "m")).rejects.toThrow(
      NotFoundError,
    );
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toHaveLength(1);
  },

  getRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    await expect(server.getRun(orgs.orgA.admin.ctx, runId)).rejects.toThrow(NotFoundError);
  },

  listRuns: async (orgs) => {
    const { workflowId, connectionId, runId } = await seedOrgBRun(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect((await server.listRuns(ctx, {})).runs).toEqual([]);
      expect((await server.listRuns(ctx, { workflowId, connectionId })).runs).toEqual([]);
      // A cursor naming org B's run finds nothing of it either.
      expect((await server.listRuns(ctx, {}, { olderThan: runId })).runs).toEqual([]);
    }
  },

  listRunFilters: async (orgs) => {
    await seedOrgBRun(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect(await server.listRunFilters(ctx)).toEqual({ workflows: [], connections: [] });
    }
    expect((await server.listRunFilters(orgs.orgB.admin.ctx)).workflows).toHaveLength(1);
  },

  startTriggeredRuns: async (orgs) => {
    // Org B's workflow is switched on for its admin's inbox; org A's fan-out is handed org B's
    // connection, as a forged or misrouted event would.
    const orgB = await seedOrgBRun(orgs);
    await switchWorkflowOn(orgs.orgB.admin.ctx, orgB.workflowId, orgB.connectionId);
    const event = {
      orgId: orgs.orgA.id,
      connectionId: orgB.connectionId,
      sourceRef: "message-1",
      occurredAt: new Date(Date.now() + 1000).toISOString(),
      labelIds: ["INBOX"],
    };

    expect(await server.startTriggeredRuns(systemCtx(orgs.orgA.id), event)).toEqual({
      runIds: [],
    });
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toHaveLength(1);
  },

  executeRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    expect(await server.executeRun(systemCtx(orgs.orgA.id), runId)).toEqual({
      status: "cancelled",
    });
    expect(await server.getRun(orgs.orgB.admin.ctx, runId)).toMatchObject({
      status: "running",
      steps: [],
    });
    expect(fakeAiGateway.requests()).toEqual([]);
  },

  failCrashedRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    await server.failCrashedRun(systemCtx(orgs.orgA.id), runId);

    expect(await server.getRun(orgs.orgB.admin.ctx, runId)).toMatchObject({
      status: "running",
      errorCode: null,
    });
  },

  searchMessages: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);

    await expect(
      server.searchMessages(orgs.orgA.admin.ctx, orgB.connectionId, "pricing", 5),
    ).rejects.toThrow(NotFoundError);
    expect(
      await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "pricing", 5),
    ).toHaveLength(1);
  },

  readMessage: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const refs = await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "", 1);

    await expect(
      server.readMessage(orgs.orgA.admin.ctx, orgB.connectionId, refs.at(0)?.id ?? "missing"),
    ).rejects.toThrow(NotFoundError);
  },

  dryRun: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const admin = orgs.orgA.admin.ctx;
    await connectInbox(admin, orgs.orgA.admin.email, []);
    const refs = await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "", 1);
    const sourceRef = refs.at(0)?.id ?? "missing";

    await expect(
      server.dryRun(admin, threadSpec(), { connectionId: orgB.connectionId, sourceRef }),
    ).rejects.toThrow(NotFoundError);
  },

  recentMessages: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    await connectInbox(orgs.orgA.admin.ctx, orgs.orgA.admin.email, []);

    const listing = await server.recentMessages(orgs.orgA.admin.ctx);

    expect(listing.map((connection) => connection.connectionId)).not.toContain(orgB.connectionId);
    expect(listing).toHaveLength(1);
  },
});
