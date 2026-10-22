import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
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

export const isolationCases = defineIsolationCases(server, {
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
    expect(await server.listRuns(orgs.orgB.admin.ctx, orgB.workflowId)).toHaveLength(1);
  },

  getRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    await expect(server.getRun(orgs.orgA.admin.ctx, runId)).rejects.toThrow(NotFoundError);
  },

  listRuns: async (orgs) => {
    const { workflowId } = await seedOrgBRun(orgs);

    expect(await server.listRuns(orgs.orgA.admin.ctx, workflowId)).toEqual([]);
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
    expect(await server.listRuns(orgs.orgB.admin.ctx, orgB.workflowId)).toHaveLength(1);
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
