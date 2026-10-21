import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { switchWorkflowOn } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError, OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

// Org B points every role at its own models and has credits; org A has neither, so a call as
// org A that read org B's rows would use org B's model or pass on org B's balance.
async function seedOrgB({ orgB }: TwoOrgs) {
  for (const role of ["classify", "fast", "smart", "judge"] as const) {
    await server.setModelRole(orgB.admin.ctx, role, `org-b/${role}`);
  }
  await grantCredits(systemCtx(orgB.id), 500);
  return { ledgerBefore: await listLedger(orgB.admin.ctx) };
}

const question = { question: "Which?", labels: ["a", "b"], state: "text" };

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

  resolveModel: async (orgs) => {
    await seedOrgB(orgs);

    expect(await server.resolveModel(orgs.orgA.admin.ctx, "fast")).toBe("test/fast-default");
  },

  openMeteredStream: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const admin = orgs.orgA.admin.ctx;

    // Org B's balance doesn't cover org A.
    await expect(server.openMeteredStream(admin, "smart")).rejects.toThrow(OutOfCreditsError);
    await grantCredits(systemCtx(orgs.orgA.id), 100);
    const stream = await server.openMeteredStream(admin, "smart");
    await stream.finish("succeeded");

    expect(stream.modelId).toBe("test/smart-default");
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
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

  setModelRole: async (orgs) => {
    await seedOrgB(orgs);

    await server.setModelRole(orgs.orgA.admin.ctx, "fast", "org-a/fast");

    expect(await server.resolveModel(orgs.orgB.admin.ctx, "fast")).toBe("org-b/fast");
  },

  callModel: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const ctxA = systemCtx(orgs.orgA.id);

    await expect(server.callModel(ctxA, "fast", { prompt: "Hi" })).rejects.toThrow(
      OutOfCreditsError,
    );
    await grantCredits(ctxA, 100);
    fakeAiGateway.text("ok", { costUsd: 0.001 });
    await server.callModel(ctxA, "fast", { prompt: "Hi" });

    expect(fakeAiGateway.requests().map((request) => request.modelId)).toEqual([
      "test/fast-default",
    ]);
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
  },

  classify: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const ctxA = systemCtx(orgs.orgA.id);

    await expect(server.classify(ctxA, question)).rejects.toThrow(OutOfCreditsError);
    await grantCredits(ctxA, 100);
    fakeAiGateway.decision({ choice: "a", probabilities: { a: 0.9, b: 0.1 } }, { costUsd: 0 });
    await server.classify(ctxA, question);

    expect(fakeAiGateway.requests().map((request) => request.modelId)).toEqual([
      "typesafe-ai/jev-1.14.0",
    ]);
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
  },
});
