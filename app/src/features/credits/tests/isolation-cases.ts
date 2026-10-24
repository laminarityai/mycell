import { expect } from "vitest";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import * as server from "../server";
import { monthRange } from "../types";

// Org B gets credits and a usage, so every case can check org B is left exactly as it was.
async function seedOrgBLedger({ orgB }: TwoOrgs) {
  await server.grantCredits(systemCtx(orgB.id), 500);
  await server.recordUsage(systemCtx(orgB.id), {
    role: "fast",
    modelId: "openai/x",
    costUsd: 0.01,
    outcome: "succeeded",
  });
  return { before: await server.listLedger(orgB.admin.ctx) };
}

// A failed call in org B whose billed cost is still to be looked up.
function failedCallInOrgB({ orgB }: TwoOrgs) {
  return server.recordUsage(systemCtx(orgB.id), {
    role: "fast",
    modelId: "openai/x",
    costUsd: 0,
    outcome: "failed",
    generationId: "gen_b",
  });
}

export const isolationCases = defineIsolationCases(server, {
  getBalance: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.getBalance(orgs.orgA.admin.ctx)).toBe(0);
  },

  isOutOfCredits: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.isOutOfCredits(orgs.orgA.admin.ctx)).toBe(true);
    expect(await server.isOutOfCredits(orgs.orgB.admin.ctx)).toBe(false);
  },

  checkCredits: async (orgs) => {
    await seedOrgBLedger(orgs);

    await expect(server.checkCredits(orgs.orgA.admin.ctx, 1)).rejects.toThrow(OutOfCreditsError);
  },

  recordUsage: async (orgs) => {
    const { before } = await seedOrgBLedger(orgs);

    await server.recordUsage(orgs.orgA.admin.ctx, {
      role: "smart",
      modelId: "openai/y",
      costUsd: 0.02,
      outcome: "succeeded",
    });

    expect(await server.listLedger(orgs.orgB.admin.ctx)).toEqual(before);
  },

  grantCredits: async (orgs) => {
    const { before } = await seedOrgBLedger(orgs);

    await server.grantCredits(systemCtx(orgs.orgA.id), 10);

    expect(await server.listLedger(orgs.orgB.admin.ctx)).toEqual(before);
    expect(await server.getBalance(orgs.orgA.admin.ctx)).toBe(10);
  },

  getSpending: async (orgs) => {
    await seedOrgBLedger(orgs);
    await server.recordUsage(systemCtx(orgs.orgB.id), {
      role: "classify",
      modelId: "openai/x",
      costUsd: 0.01,
      outcome: "succeeded",
      purpose: "memory",
    });
    const since = new Date(Date.now() - 3_600_000);

    expect(await server.getSpending(orgs.orgB.admin.ctx, { purpose: "memory", since })).toBe(10);
    expect(await server.getSpending(orgs.orgA.admin.ctx, { purpose: "memory", since })).toBe(0);
  },

  findUncostedFailedCall: async (orgs) => {
    await seedOrgBLedger(orgs);
    const failed = await failedCallInOrgB(orgs);

    expect(await server.findUncostedFailedCall(systemCtx(orgs.orgA.id), failed.id)).toBeUndefined();
    expect(await server.findUncostedFailedCall(systemCtx(orgs.orgB.id), failed.id)).toBeDefined();
  },

  recordFailedCallCost: async (orgs) => {
    await seedOrgBLedger(orgs);
    const failed = await failedCallInOrgB(orgs);
    const before = await server.listLedger(orgs.orgB.admin.ctx);

    // Org B's failed call, from org A: nothing is recorded in either org.
    expect(
      await server.recordFailedCallCost(systemCtx(orgs.orgA.id), failed.id, 0.01),
    ).toBeUndefined();
    expect(await server.listLedger(orgs.orgA.admin.ctx)).toEqual([]);
    expect(await server.listLedger(orgs.orgB.admin.ctx)).toEqual(before);
  },

  listLedger: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.listLedger(orgs.orgA.admin.ctx)).toEqual([]);
    expect(await server.listLedger(orgs.orgA.admin.ctx, { kind: "grant" })).toEqual([]);
  },

  getSpendingSummary: async (orgs) => {
    await seedOrgBLedger(orgs);
    await server.recordUsage(systemCtx(orgs.orgB.id), {
      role: "fast",
      modelId: "openai/x",
      costUsd: 0.01,
      outcome: "succeeded",
      workflowId: "wf_b",
      runId: "run_b",
    });

    const summary = await server.getSpendingSummary(orgs.orgA.admin.ctx, monthRange(new Date()));

    expect(summary).toMatchObject({ openingBalance: 0, spent: 0, granted: 0, byWorkflow: [] });
    expect(summary.days.every((day) => day.spent === 0 && day.granted === 0)).toBe(true);
  },

  getLedgerStart: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.getLedgerStart(orgs.orgA.admin.ctx)).toBeNull();
    expect(await server.getLedgerStart(orgs.orgB.admin.ctx)).toBeInstanceOf(Date);
  },

  getRunway: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.getRunway(orgs.orgA.admin.ctx)).toEqual({
      balance: 0,
      dailyRate: null,
      days: null,
      zeroAt: null,
    });
  },

  spentThisMonthByWorkflow: async (orgs) => {
    await seedOrgBWorkflowRun(orgs);

    expect(await server.spentThisMonthByWorkflow(orgs.orgA.admin.ctx, ["wf-b"])).toEqual(
      new Map([["wf-b", 0]]),
    );
    expect(await server.spentThisMonthByWorkflow(orgs.orgB.admin.ctx, ["wf-b"])).toEqual(
      new Map([["wf-b", 10]]),
    );
  },

  budgetsReached: async (orgs) => {
    await seedOrgBWorkflowRun(orgs);
    const budgets = new Map([["wf-b", 5]]);

    expect(await server.budgetsReached(orgs.orgA.member.ctx, budgets)).toEqual(new Set());
    expect(await server.budgetsReached(orgs.orgB.member.ctx, budgets)).toEqual(new Set(["wf-b"]));
  },

  budgetsReachedOn: async (orgs) => {
    await seedOrgBWorkflowRun(orgs);
    const budgets = new Map([["wf-b", 5]]);

    expect(await server.budgetsReachedOn(orgs.orgA.admin.ctx, budgets)).toEqual(new Map());
    expect(await server.budgetsReachedOn(systemCtx(orgs.orgA.id), budgets)).toEqual(new Map());
    expect([...(await server.budgetsReachedOn(orgs.orgB.admin.ctx, budgets)).keys()]).toEqual([
      "wf-b",
    ]);
  },

  nextMonthStart: notTenantScoped("a date worked out from the clock alone"),
});

// Org B's workflow `wf-b` spends 10 credits in a live run.
async function seedOrgBWorkflowRun(orgs: TwoOrgs) {
  await seedOrgBLedger(orgs);
  await server.recordUsage(systemCtx(orgs.orgB.id), {
    role: "fast",
    modelId: "openai/x",
    costUsd: 0.01,
    outcome: "succeeded",
    workflowId: "wf-b",
    runId: "run-b",
  });
}
