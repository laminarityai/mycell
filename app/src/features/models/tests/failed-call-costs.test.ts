import { streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, grantCredits, listLedger } from "@/features/credits/server";
import type { LedgerEntry } from "@/features/credits/types";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { callModel, correctFailedCallCost, openMeteredStream } from "../server";
import { GenerationLookupError, ModelCallError } from "../types";
import { testPrompts } from "./requests";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const FAILED_CALL = "models/failed-call.recorded";

async function orgWithCredits() {
  const { orgA } = await seedTwoOrgs();
  const ctx = systemCtx(orgA.id);
  await grantCredits(ctx, 100);
  return { orgA, ctx };
}

/** A `fast` call for a workflow's run that fails on the gateway; its usage entry's ID. */
async function failedRunCall(ctx: Ctx): Promise<string> {
  await expect(
    callModel(ctx, "fast", { prompt: testPrompts.hi(), workflowId: "wf_1", runId: "run_1" }),
  ).rejects.toThrow(ModelCallError);
  const entry = (await listLedger(ctx, 1)).at(0);
  if (entry === undefined) throw new Error("The failed call left no entry.");
  return entry.id;
}

/** The workflow's spending, in credits, as its ledger entries add up. */
function spentBy(entries: LedgerEntry[], workflowId: string): number {
  return -entries
    .filter((entry) => entry.kind === "usage" && entry.workflowId === workflowId)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

describe("a failed call's billed cost", () => {
  it("is queued for lookup when the call failed at 0 under a generation ID", async () => {
    const { orgA, ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });

    const entryId = await failedRunCall(ctx);

    expect(fakeInngest.sent(FAILED_CALL)).toEqual([
      expect.objectContaining({ id: `failed-call-${entryId}`, data: { orgId: orgA.id, entryId } }),
    ]);
  });

  it("is added to the balance and the workflow's spending by the job", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });
    const entryId = await failedRunCall(ctx);
    expect(await getBalance(ctx)).toBe(100);

    expect(await correctFailedCallCost(ctx, entryId)).toBe("corrected");

    // 0.004 US dollars at 1000 credits a dollar.
    expect(await getBalance(ctx)).toBeCloseTo(96);
    const ledger = await listLedger(ctx);
    expect(spentBy(ledger, "wf_1")).toBeCloseTo(4);
    const original = ledger.find((entry) => entry.id === entryId);
    expect(ledger.find((entry) => entry.correctsId === entryId)).toMatchObject({
      kind: "usage",
      role: "fast",
      modelId: "test/fast-default",
      outcome: "failed",
      costUsd: 0.004,
      generationId: "gen_1",
      workflowId: "wf_1",
      runId: "run_1",
      dryRun: false,
      purpose: null,
      // At the call's own time, so it counts in the call's month.
      createdAt: original?.createdAt,
    });
    expect(fakeAiGateway.lookups()).toEqual(["gen_1"]);
  });

  it("keeps a dry run's and a purpose's attribution", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { generationId: "gen_dry", billedUsd: 0.001 });
    fakeAiGateway.fail("language", { generationId: "gen_memory", billedUsd: 0.002 });
    await expect(
      callModel(ctx, "fast", { prompt: testPrompts.hi(), workflowId: "wf_1", dryRun: true }),
    ).rejects.toThrow(ModelCallError);
    await expect(
      callModel(ctx, "fast", { prompt: testPrompts.hi(), purpose: "memory" }),
    ).rejects.toThrow(ModelCallError);

    for (const event of fakeInngest.sent(FAILED_CALL)) {
      expect(await correctFailedCallCost(ctx, String(event.data.entryId))).toBe("corrected");
    }

    const corrections = (await listLedger(ctx)).filter((entry) => entry.correctsId !== null);
    expect(corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ generationId: "gen_dry", dryRun: true, workflowId: "wf_1" }),
        expect.objectContaining({ generationId: "gen_memory", purpose: "memory" }),
      ]),
    );
  });

  it("changes nothing when the job runs twice", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });
    const entryId = await failedRunCall(ctx);
    await correctFailedCallCost(ctx, entryId);
    const ledger = await listLedger(ctx);

    expect(await correctFailedCallCost(ctx, entryId)).toBe("nothing_to_correct");

    expect(await listLedger(ctx)).toEqual(ledger);
    expect(await getBalance(ctx)).toBeCloseTo(96);
    expect(fakeAiGateway.lookups()).toEqual(["gen_1"]);
  });

  it("is looked for again while the gateway doesn't know the generation yet", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1" });
    const entryId = await failedRunCall(ctx);

    expect(await correctFailedCallCost(ctx, entryId)).toBe("not_billed_yet");
    expect(await getBalance(ctx)).toBe(100);

    fakeAiGateway.bill("gen_1", 0.002);
    expect(await correctFailedCallCost(ctx, entryId)).toBe("corrected");
    expect(await getBalance(ctx)).toBeCloseTo(98);
    expect(fakeAiGateway.lookups()).toEqual(["gen_1", "gen_1"]);
  });

  it("is looked for again while the gateway is failing", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });
    const entryId = await failedRunCall(ctx);
    fakeAiGateway.failLookups(503);

    expect(await correctFailedCallCost(ctx, entryId)).toBe("not_billed_yet");
    expect(await getBalance(ctx)).toBe(100);
  });

  it("throws when the gateway refuses the lookup itself", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });
    const entryId = await failedRunCall(ctx);
    fakeAiGateway.failLookups(403);

    await expect(correctFailedCallCost(ctx, entryId)).rejects.toThrow(GenerationLookupError);
  });

  it("is given up a day after the call", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1" });
    const entryId = await failedRunCall(ctx);
    expect(await correctFailedCallCost(ctx, entryId)).toBe("not_billed_yet");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
    fakeAiGateway.bill("gen_1", 0.002);

    expect(await correctFailedCallCost(ctx, entryId)).toBe("given_up");
    expect(await getBalance(ctx)).toBe(100);
    expect(fakeAiGateway.lookups()).toEqual(["gen_1"]);
  });

  it("stays at 0 for a call without a generation ID, which queues nothing", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503 });
    const entryId = await failedRunCall(ctx);

    expect(fakeInngest.sent(FAILED_CALL)).toEqual([]);
    expect(await correctFailedCallCost(ctx, entryId)).toBe("nothing_to_correct");
    expect(await getBalance(ctx)).toBe(100);
    expect(fakeAiGateway.lookups()).toEqual([]);
  });

  it("queues nothing for a call that succeeded", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.text("Hi", { costUsd: 0 });

    await callModel(ctx, "fast", { prompt: testPrompts.hi() });

    expect(fakeInngest.sent(FAILED_CALL)).toEqual([]);
  });

  it("is queued for a streamed call that failed under a generation ID", async () => {
    const { ctx } = await orgWithCredits();
    const stream = await openMeteredStream(ctx, "smart");
    stream.meterStep({ gateway: { generationId: "gen_stream" } });

    await stream.finish("failed");

    const event = fakeInngest.sent(FAILED_CALL).at(0);
    fakeAiGateway.bill("gen_stream", 0.01);
    expect(await correctFailedCallCost(ctx, String(event?.data.entryId))).toBe("corrected");
    expect(await getBalance(ctx)).toBeCloseTo(90);
  });

  it("is queued for a stream whose failed step's gateway error carries a generation ID", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { streaming: true, generationId: "gen_step", billedUsd: 0.01 });
    const stream = await openMeteredStream(ctx, "smart");
    const result = streamText({
      model: stream.model,
      prompt: "Hi",
      maxRetries: 0,
      onError: ({ error }) => {
        stream.meterError(error);
      },
    });
    await result.consumeStream();

    await stream.finish("failed");

    const event = fakeInngest.sent(FAILED_CALL).at(0);
    expect(await correctFailedCallCost(ctx, String(event?.data.entryId))).toBe("corrected");
    expect(await getBalance(ctx)).toBeCloseTo(90);
    expect(fakeAiGateway.lookups()).toEqual(["gen_step"]);
  });

  it("leaves the call's own error when the lookup can't be queued", async () => {
    const { ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1" });
    fakeInngest.failSends();

    await failedRunCall(ctx);

    fakeInngest.failSends(false);
    expect(fakeInngest.sent(FAILED_CALL)).toEqual([]);
  });

  it("is corrected only by jobs", async () => {
    const { orgA, ctx } = await orgWithCredits();
    fakeAiGateway.fail("language", { status: 503, generationId: "gen_1", billedUsd: 0.004 });
    const entryId = await failedRunCall(ctx);

    await expect(correctFailedCallCost(orgA.admin.ctx, entryId)).rejects.toThrow(ForbiddenError);
  });
});
