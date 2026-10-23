import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import {
  checkCredits,
  getBalance,
  getSpending,
  grantCredits,
  isOutOfCredits,
  listLedger,
  recordUsage,
} from "../server";
import { spendingKindOf } from "../types";

beforeEach(resetDatabase);

describe("the credit balance", () => {
  it("starts at zero", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await getBalance(orgA.admin.ctx)).toBe(0);
  });

  it("goes up by a grant and down by each usage, at 1000 credits per dollar", async () => {
    const { orgA } = await seedTwoOrgs();

    await grantCredits(systemCtx(orgA.id), 100);
    await recordUsage(orgA.admin.ctx, {
      role: "fast",
      modelId: "openai/x",
      costUsd: 0.0125,
      outcome: "succeeded",
    });

    expect(await getBalance(orgA.admin.ctx)).toBeCloseTo(87.5);
  });

  it("is out of credits at or below zero, and not once a grant brings it above", async () => {
    const { orgA } = await seedTwoOrgs();
    const system = systemCtx(orgA.id);
    const spend = (costUsd: number) =>
      recordUsage(system, { role: "fast", modelId: "openai/x", costUsd, outcome: "succeeded" });

    expect(await isOutOfCredits(orgA.admin.ctx)).toBe(true);
    await grantCredits(system, 10);
    expect(await isOutOfCredits(orgA.admin.ctx)).toBe(false);
    // 10 credits: exactly the balance.
    await spend(0.01);
    expect(await isOutOfCredits(orgA.admin.ctx)).toBe(true);
    await spend(0.01);
    expect(await isOutOfCredits(orgA.admin.ctx)).toBe(true);
    await grantCredits(system, 25);
    expect(await isOutOfCredits(orgA.admin.ctx)).toBe(false);
  });

  it("only lets our team grant credits, through the system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(grantCredits(orgA.admin.ctx, 100)).rejects.toThrow(ForbiddenError);
    await expect(grantCredits(systemCtx(orgA.id), 0)).rejects.toThrow(ValidationError);
    expect(await getBalance(orgA.admin.ctx)).toBe(0);
  });
});

describe("checkCredits", () => {
  it("passes when the balance covers the estimate", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 10);

    await expect(checkCredits(orgA.admin.ctx, 10)).resolves.toBeUndefined();
  });

  it("throws OutOfCreditsError when the balance is below the estimate", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 4);

    await expect(checkCredits(orgA.admin.ctx, 5)).rejects.toThrow(OutOfCreditsError);
  });
});

describe("listLedger", () => {
  it("lists entries newest first, with what each usage was for", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 50);
    await recordUsage(systemCtx(orgA.id), {
      role: "classify",
      modelId: "typesafe-ai/jev-1.14.0",
      costUsd: 0,
      outcome: "failed",
      generationId: "gen_1",
      workflowId: "wf_1",
      runId: "run_1",
    });

    expect(await listLedger(orgA.admin.ctx)).toMatchObject([
      {
        kind: "usage",
        amount: 0,
        role: "classify",
        modelId: "typesafe-ai/jev-1.14.0",
        costUsd: 0,
        outcome: "failed",
        generationId: "gen_1",
        workflowId: "wf_1",
        runId: "run_1",
      },
      { kind: "grant", amount: 50, role: null, costUsd: null },
    ]);
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listLedger(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});

describe("getSpending", () => {
  it("adds up the credits one purpose used since a time, and nothing else", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    await grantCredits(ctx, 100);
    const call = { role: "fast" as const, modelId: "openai/x", outcome: "succeeded" as const };
    await recordUsage(ctx, { ...call, costUsd: 0.002, purpose: "memory" });
    await recordUsage(ctx, {
      ...call,
      role: null,
      modelId: "google/model-armor",
      costUsd: 0.001,
      purpose: "memory",
    });
    // A workflow's call isn't memory's.
    await recordUsage(ctx, { ...call, costUsd: 0.05 });

    const anHourAgo = new Date(Date.now() - 3_600_000);
    expect(await getSpending(ctx, { purpose: "memory", since: anHourAgo })).toBeCloseTo(3);
    const inAnHour = new Date(Date.now() + 3_600_000);
    expect(await getSpending(ctx, { purpose: "memory", since: inAnHour })).toBe(0);
    expect((await listLedger(ctx)).map((entry) => entry.purpose).sort()).toEqual([
      "memory",
      "memory",
      null,
      null,
    ]);
  });
});

describe("spendingKindOf", () => {
  it("puts each usage in the kind of use its attribution names, and a grant in none", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    const grant = await grantCredits(ctx, 100);
    const call = { role: "fast" as const, modelId: "openai/x", outcome: "succeeded" as const };
    const usage = [
      await recordUsage(ctx, { ...call, costUsd: 0.001, workflowId: "wf_1", runId: "run_1" }),
      await recordUsage(ctx, { ...call, costUsd: 0.001, workflowId: "wf_1", dryRun: true }),
      await recordUsage(ctx, { ...call, costUsd: 0.001, purpose: "builder" }),
      await recordUsage(ctx, { ...call, costUsd: 0.001, purpose: "memory" }),
      await recordUsage(ctx, { ...call, costUsd: 0.001, purpose: "memory_summary" }),
      await recordUsage(ctx, { ...call, costUsd: 0.001, purpose: "agent" }),
    ];

    // A person's summaries are memory's here, though memory's budget adds up only learning.
    expect(usage.map(spendingKindOf)).toEqual([
      "workflow",
      "try_it",
      "builder",
      "memory",
      "memory",
      "agent",
    ]);
    expect(spendingKindOf(grant)).toBeNull();
  });
});
