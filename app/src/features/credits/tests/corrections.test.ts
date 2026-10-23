import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import {
  findUncostedFailedCall,
  getBalance,
  grantCredits,
  listLedger,
  recordFailedCallCost,
  recordUsage,
} from "../server";
import type { Usage } from "../types";

beforeEach(resetDatabase);

const failedCall: Usage = {
  role: "fast",
  modelId: "openai/x",
  costUsd: 0,
  outcome: "failed",
  generationId: "gen_1",
  workflowId: "wf_1",
  runId: "run_1",
};

async function orgWithFailedCall(usage: Usage = failedCall) {
  const { orgA } = await seedTwoOrgs();
  const ctx = systemCtx(orgA.id);
  await grantCredits(ctx, 100);
  const entry = await recordUsage(ctx, usage);
  return { orgA, ctx, entry };
}

describe("findUncostedFailedCall", () => {
  it("finds a failed call recorded at 0 under a generation ID, until it's corrected", async () => {
    const { ctx, entry } = await orgWithFailedCall();

    expect(await findUncostedFailedCall(ctx, entry.id)).toEqual({
      id: entry.id,
      generationId: "gen_1",
      createdAt: entry.createdAt,
    });
    await recordFailedCallCost(ctx, entry.id, 0.003);
    expect(await findUncostedFailedCall(ctx, entry.id)).toBeUndefined();
  });

  it("finds no call that succeeded, reported a cost or has no generation ID", async () => {
    const { ctx } = await orgWithFailedCall();
    const others = [
      await recordUsage(ctx, { ...failedCall, outcome: "succeeded" }),
      await recordUsage(ctx, { ...failedCall, costUsd: 0.001 }),
      await recordUsage(ctx, { ...failedCall, generationId: undefined }),
    ];

    for (const other of others) {
      expect(await findUncostedFailedCall(ctx, other.id)).toBeUndefined();
    }
  });
});

describe("recordFailedCallCost", () => {
  it("records the billed cost once, however often it's called", async () => {
    const { ctx, entry } = await orgWithFailedCall();

    const [first, second] = await Promise.all([
      recordFailedCallCost(ctx, entry.id, 0.003),
      recordFailedCallCost(ctx, entry.id, 0.003),
    ]);
    const third = await recordFailedCallCost(ctx, entry.id, 0.003);

    expect([first, second].filter((correction) => correction !== undefined)).toHaveLength(1);
    expect(third).toBeUndefined();
    expect(await getBalance(ctx)).toBeCloseTo(97);
    expect((await listLedger(ctx)).filter((row) => row.correctsId === entry.id)).toHaveLength(1);
  });

  it("never corrects a correction", async () => {
    const { ctx, entry } = await orgWithFailedCall();
    // Billed nothing: the correction is at 0, under the same generation ID.
    const correction = await recordFailedCallCost(ctx, entry.id, 0);

    expect(correction).toMatchObject({ correctsId: entry.id, amount: 0 });
    expect(await recordFailedCallCost(ctx, correction?.id ?? "", 0.5)).toBeUndefined();
    expect(await findUncostedFailedCall(ctx, correction?.id ?? "")).toBeUndefined();
    expect(await getBalance(ctx)).toBe(100);
  });

  it("refuses a cost below zero", async () => {
    const { ctx, entry } = await orgWithFailedCall();

    await expect(recordFailedCallCost(ctx, entry.id, -1)).rejects.toThrow(ValidationError);
  });

  it("is for jobs only", async () => {
    const { orgA, entry } = await orgWithFailedCall();

    await expect(recordFailedCallCost(orgA.admin.ctx, entry.id, 0.003)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(findUncostedFailedCall(orgA.admin.ctx, entry.id)).rejects.toThrow(ForbiddenError);
  });
});
