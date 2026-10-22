import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import * as server from "../server";

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

export const isolationCases = defineIsolationCases(server, {
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
