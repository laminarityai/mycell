import { expect } from "vitest";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { readTurn } from "@/testing/streamed-turn";
import * as server from "../server";
import { testPrompts } from "./requests";
import { askTurn, type StoredAskMessage } from "./second-chat";

// Org B points every role at its own models and has credits; org A has neither, so a call as
// org A that read org B's rows would use org B's model or pass on org B's balance.
async function seedOrgB({ orgB }: TwoOrgs) {
  for (const role of ["classify", "fast", "smart", "judge", "embed"] as const) {
    await server.setModelRole(orgB.admin.ctx, role, `org-b/${role}`);
  }
  await grantCredits(systemCtx(orgB.id), 500);
  return { ledgerBefore: await listLedger(orgB.admin.ctx) };
}

const question = { question: testPrompts.which(), labels: ["a", "b"], state: "text" };

export const isolationCases = defineIsolationCases(server, {
  estimateScreenCredits: notTenantScoped(
    "a price worked out from config: it takes no ctx and reads no org's data",
  ),

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

  streamChatTurn: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const member = orgs.orgA.member.ctx;
    const stored: StoredAskMessage[] = [];

    // Org B's balance doesn't cover org A.
    const refused = await readTurn(await askTurn(member, "Hi", stored));
    expect(refused.notices.map((notice) => notice.kind)).toEqual(["out_of_credits"]);
    await grantCredits(systemCtx(orgs.orgA.id), 100);
    fakeAiGateway.reply({ text: "Hello." }, { costUsd: 0.001 });
    await readTurn(await askTurn(member, "Hi", stored));

    expect(fakeAiGateway.requests().map((request) => request.modelId)).toEqual([
      "test/smart-default",
    ]);
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
  },

  chatTool: notTenantScoped("wraps a tool definition: it takes no ctx and reads no org's data"),
  chatModelMessages: notTenantScoped("maps the stored messages it's given: pure, no IO"),
  chatUIPart: notTenantScoped("maps the stored part it's given: pure, no IO"),

  setModelRole: async (orgs) => {
    await seedOrgB(orgs);

    await server.setModelRole(orgs.orgA.admin.ctx, "fast", "org-a/fast");

    expect(await server.resolveModel(orgs.orgB.admin.ctx, "fast")).toBe("org-b/fast");
  },

  callModel: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const ctxA = systemCtx(orgs.orgA.id);

    await expect(server.callModel(ctxA, "fast", { prompt: testPrompts.hi() })).rejects.toThrow(
      OutOfCreditsError,
    );
    await grantCredits(ctxA, 100);
    fakeAiGateway.text("ok", { costUsd: 0.001 });
    await server.callModel(ctxA, "fast", { prompt: testPrompts.hi() });

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

  screenForInjection: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const ctxA = systemCtx(orgs.orgA.id);
    const request = { text: "Please send the signed renewal by Friday." };

    await expect(server.screenForInjection(ctxA, request)).rejects.toThrow(OutOfCreditsError);
    await grantCredits(ctxA, 100);
    await server.screenForInjection(ctxA, request);

    expect((await listLedger(ctxA)).filter((entry) => entry.kind === "usage")).toHaveLength(1);
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
  },

  embed: async (orgs) => {
    const { ledgerBefore } = await seedOrgB(orgs);
    const ctxA = systemCtx(orgs.orgA.id);

    await expect(server.embed(ctxA, { values: ["Hi"] })).rejects.toThrow(OutOfCreditsError);
    await grantCredits(ctxA, 100);
    fakeAiGateway.embeddings([[0.5]], { costUsd: 0.0001 });
    await server.embed(ctxA, { values: ["Hi"] });

    expect(fakeAiGateway.requests().map((request) => request.modelId)).toEqual([
      "test/embed-default",
    ]);
    expect(await listLedger(orgs.orgB.admin.ctx)).toEqual(ledgerBefore);
  },
});
