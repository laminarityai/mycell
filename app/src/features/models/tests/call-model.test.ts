import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { callModel, setModelRole } from "../server";
import { ModelCallError } from "../types";

beforeEach(resetDatabase);

async function orgWithCredits(credits = 100) {
  const { orgA } = await seedTwoOrgs();
  await grantCredits(systemCtx(orgA.id), credits);
  return { orgA, ctx: systemCtx(orgA.id) };
}

async function usages(ctx: Ctx) {
  return (await listLedger(ctx)).filter((entry) => entry.kind === "usage");
}

describe("callModel", () => {
  it("returns the text and leaves one usage entry with the gateway's cost", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.text("Thanks, we'll be in touch.", { costUsd: 0.002 });

    const result = await callModel(ctx, "fast", {
      prompt: "Write a reply.",
      workflowId: "wf_1",
      runId: "run_1",
    });

    expect(result).toEqual({
      output: "Thanks, we'll be in touch.",
      modelId: "test/fast-default",
      costUsd: 0.002,
    });
    expect(await usages(ctx)).toMatchObject([
      {
        role: "fast",
        modelId: "test/fast-default",
        costUsd: 0.002,
        outcome: "succeeded",
        workflowId: "wf_1",
        runId: "run_1",
      },
    ]);
    expect(await getBalance(ctx)).toBeCloseTo(98);
  });

  it("returns structured output parsed by the request's schema", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.object({ name: "Ada", quantity: 3 }, { costUsd: 0.001 });

    const result = await callModel(ctx, "smart", {
      prompt: "Extract the order.",
      schema: z.object({ name: z.string(), quantity: z.number() }),
    });

    expect(result.output).toEqual({ name: "Ada", quantity: 3 });
    expect(fakeAiGateway.requests("language")[0]?.modelId).toBe("test/smart-default");
  });

  it("calls the model the org chose for the role", async () => {
    const { orgA, ctx } = await orgWithCredits();
    await setModelRole(orgA.admin.ctx, "fast", "openai/org-choice");
    fakeAiGateway.text("ok", { costUsd: 0.001, model: "openai/org-choice" });

    expect((await callModel(ctx, "fast", { prompt: "Hi" })).modelId).toBe("openai/org-choice");
    expect((await usages(ctx))[0]?.modelId).toBe("openai/org-choice");
  });

  it("makes no request and records nothing when the balance is below the role's estimate", async () => {
    // The fast estimate is 5 credits.
    const { ctx } = await orgWithCredits(4);

    await expect(callModel(ctx, "fast", { prompt: "Hi" })).rejects.toThrow(OutOfCreditsError);

    expect(fakeAiGateway.requests()).toEqual([]);
    expect(await usages(ctx)).toEqual([]);
  });

  it("records a failed call at no cost, with its generation ID, and throws a coded error", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_42" });

    const error = await callModel(ctx, "fast", { prompt: "Hi" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ code: "gateway_error", role: "fast", status: 503 });
    expect((error as Error).cause).toBeUndefined();
    expect(await usages(ctx)).toMatchObject([
      { role: "fast", costUsd: 0, outcome: "failed", generationId: "gen_42" },
    ]);
    expect(await getBalance(ctx)).toBe(100);
  });

  it("records an off-schema answer's cost and keeps its content out of the error", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.object({ secret: "Dear Ada, your order 1234" }, { costUsd: 0.003 });

    const error = await callModel(ctx, "smart", {
      prompt: "Extract the order.",
      schema: z.object({ name: z.string() }),
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "off_schema", role: "smart" });
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error) + String(error) + String((error as Error).stack)).not.toContain(
      "Ada",
    );
    expect(await usages(ctx)).toMatchObject([{ costUsd: 0.003, outcome: "failed" }]);
    expect(await getBalance(ctx)).toBeCloseTo(97);
  });
});
