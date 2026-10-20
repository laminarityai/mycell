import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import * as server from "../server";

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

export const isolationCases = defineIsolationCases(server, {
  getBalance: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.getBalance(orgs.orgA.admin.ctx)).toBe(0);
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

  listLedger: async (orgs) => {
    await seedOrgBLedger(orgs);

    expect(await server.listLedger(orgs.orgA.admin.ctx)).toEqual([]);
  },
});
