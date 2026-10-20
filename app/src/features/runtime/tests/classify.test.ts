import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { classify, setModelRole } from "../server";
import { ModelCallError } from "../types";

beforeEach(resetDatabase);

const request = {
  question: "Is this message asking for a quote?",
  labels: ["quote", "other"],
  state: "From: ada@example.com\nSubject: Prices\n\nHow much for 30 chairs?",
  runId: "run_1",
};

async function orgWithCredits(credits = 100) {
  const { orgA } = await seedTwoOrgs();
  await grantCredits(systemCtx(orgA.id), credits);
  return { orgA, ctx: systemCtx(orgA.id) };
}

async function usages(ctx: Ctx) {
  return (await listLedger(ctx)).filter((entry) => entry.kind === "usage").reverse();
}

describe("classify", () => {
  it("asks Jev one choice question and returns its label with that label's probability", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.decision(
      { choice: "quote", probabilities: { quote: 0.91, other: 0.09 } },
      { costUsd: 0.0001 },
    );

    const result = await classify(ctx, request);

    expect(result).toEqual({
      label: "quote",
      p: 0.91,
      modelId: "typesafe-ai/jev-1.14.0",
      costUsd: 0.0001,
      fallback: false,
    });
    const sent = fakeAiGateway.requests("decision").at(0);
    expect(sent?.modelId).toBe("typesafe-ai/jev-1.14.0");
    expect(Object.values(sent?.body.questions ?? {})).toEqual([
      {
        type: "choice",
        instructions: request.question,
        criteria: { quote: null, other: null },
      },
    ]);
    expect(await usages(ctx)).toMatchObject([
      { role: "classify", modelId: "typesafe-ai/jev-1.14.0", costUsd: 0.0001, runId: "run_1" },
    ]);
    expect(await getBalance(ctx)).toBeCloseTo(99.9);
  });

  it("falls back to a structured output on fast when Jev fails, and says so", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("decision", { status: 500 });
    fakeAiGateway.object({ label: "other", p: 0.7 }, { costUsd: 0.002 });

    const result = await classify(ctx, request);

    expect(result).toEqual({
      label: "other",
      p: 0.7,
      modelId: "test/fast-default",
      costUsd: 0.002,
      fallback: true,
    });
    expect(await usages(ctx)).toMatchObject([
      { role: "classify", outcome: "failed", costUsd: 0 },
      { role: "fast", outcome: "succeeded", costUsd: 0.002, runId: "run_1" },
    ]);
  });

  it.each([
    ["refuses", "refusal" as const],
    ["answers without probabilities", { choice: "quote" }],
    ["picks a label that wasn't offered", { choice: "spam", probabilities: { spam: 1 } }],
  ])("falls back when Jev %s", async (_why, answer) => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.decision(answer, { costUsd: 0.0001 });
    fakeAiGateway.object({ label: "quote", p: 0.8 }, { costUsd: 0.002 });

    expect(await classify(ctx, request)).toMatchObject({ label: "quote", fallback: true });
    expect(await usages(ctx)).toMatchObject([
      { role: "classify", outcome: "failed", costUsd: 0.0001 },
      { role: "fast", outcome: "succeeded" },
    ]);
  });

  it("goes straight to fast when the org's classify model isn't a decision model", async () => {
    const { orgA, ctx } = await orgWithCredits();
    await setModelRole(orgA.admin.ctx, "classify", "openai/some-chat-model");
    fakeAiGateway.object({ label: "quote", p: 0.6 }, { costUsd: 0.002 });

    expect(await classify(ctx, request)).toMatchObject({ label: "quote", fallback: true });
    expect(fakeAiGateway.requests("decision")).toEqual([]);
    expect(await usages(ctx)).toMatchObject([{ role: "fast" }]);
  });

  it("fails with a coded error when the fallback answers off the labels too", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("decision");
    fakeAiGateway.object({ label: "spam", p: 2 }, { costUsd: 0.002 });

    const error = await classify(ctx, request).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ code: "off_schema", role: "fast" });
  });

  it("makes no request when the balance can't cover the classify estimate", async () => {
    const { ctx } = await orgWithCredits(0.5);

    await expect(classify(ctx, request)).rejects.toThrow(OutOfCreditsError);
    expect(fakeAiGateway.requests()).toEqual([]);
  });
});
