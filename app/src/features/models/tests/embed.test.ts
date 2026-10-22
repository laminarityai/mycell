import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { embed, setModelRole } from "../server";
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

describe("embed", () => {
  it("returns one vector per text and leaves one usage entry with the gateway's cost", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.embeddings(
      [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      { costUsd: 0.0001 },
    );

    const result = await embed(ctx, {
      values: ["Acme's renewal is in March.", "Ada handles Acme."],
      workflowId: "wf_1",
    });

    expect(result).toEqual({
      output: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      modelId: "test/embed-default",
      costUsd: 0.0001,
    });
    expect(fakeAiGateway.requests("embedding")).toMatchObject([
      {
        modelId: "test/embed-default",
        body: { values: ["Acme's renewal is in March.", "Ada handles Acme."] },
      },
    ]);
    expect(await usages(ctx)).toMatchObject([
      {
        role: "embed",
        modelId: "test/embed-default",
        costUsd: 0.0001,
        outcome: "succeeded",
        workflowId: "wf_1",
      },
    ]);
    expect(await getBalance(ctx)).toBeCloseTo(99.9);
  });

  it("calls the model the org chose for the embed role", async () => {
    const { orgA, ctx } = await orgWithCredits();
    await setModelRole(orgA.admin.ctx, "embed", "openai/org-embedder");
    fakeAiGateway.embeddings([[1, 0]], { model: "openai/org-embedder" });

    expect((await embed(ctx, { values: ["Hi"] })).modelId).toBe("openai/org-embedder");
    expect((await usages(ctx))[0]?.modelId).toBe("openai/org-embedder");
  });

  it("makes no request and records nothing when the balance is below the embed estimate", async () => {
    // The embed estimate is 1 credit.
    const { ctx } = await orgWithCredits(0.5);

    await expect(embed(ctx, { values: ["Hi"] })).rejects.toThrow(OutOfCreditsError);

    expect(fakeAiGateway.requests()).toEqual([]);
    expect(await usages(ctx)).toEqual([]);
  });

  it("records a failed call and throws a coded error with no text in it", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("embedding", { status: 503, generationId: "gen_7" });

    const error = await embed(ctx, { values: ["Dear Ada, your order 1234"] }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ code: "gateway_error", role: "embed", status: 503 });
    expect(String(error) + String((error as Error).stack)).not.toContain("Ada");
    expect(await usages(ctx)).toMatchObject([
      { role: "embed", costUsd: 0, outcome: "failed", generationId: "gen_7" },
    ]);
  });

  it("records one entry with the summed cost when the texts take several gateway requests", async () => {
    const { ctx } = await orgWithCredits();
    // The gateway takes at most 2048 texts a request, so 2050 take two.
    const values = Array.from({ length: 2050 }, (_, index) => `fact ${String(index)}`);
    fakeAiGateway.embeddings(
      Array.from({ length: 2048 }, () => [1]),
      { costUsd: 0.002 },
    );
    fakeAiGateway.embeddings([[2], [2]], { costUsd: 0.001 });

    const result = await embed(ctx, { values });

    expect(result.output).toHaveLength(2050);
    expect(result.output.at(-1)).toEqual([2]);
    expect(result.costUsd).toBeCloseTo(0.003, 6);
    expect(fakeAiGateway.requests("embedding")).toHaveLength(2);
    expect(await usages(ctx)).toMatchObject([{ role: "embed", outcome: "succeeded" }]);
    expect((await usages(ctx))[0]?.costUsd).toBeCloseTo(0.003, 6);
  });
});
