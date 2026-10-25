// What a workflow's budget counts (M7): its live runs' usage this calendar month (UTC), never
// Try it's or anything else's, worked out from the ledger whenever it's asked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import {
  budgetsReached,
  budgetsReachedOn,
  grantCredits,
  recordUsage,
  spentThisMonthByWorkflow,
} from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const call = { role: "fast" as const, modelId: "openai/x", outcome: "succeeded" as const };

/** Org A with credits, where each call below costs `credits` (at 1000 credits per dollar). */
async function funded() {
  const { orgA } = await seedTwoOrgs();
  const system = systemCtx(orgA.id);
  await grantCredits(system, 1000);
  const spend = (credits: number, attribution: Record<string, unknown> = {}) =>
    recordUsage(system, { ...call, costUsd: credits / 1000, ...attribution });
  return { orgA, system, spend };
}

describe("spentThisMonthByWorkflow", () => {
  it("adds up each workflow's live run usage this month", async () => {
    const { orgA, spend } = await funded();
    await spend(4, { workflowId: "wf-1", runId: "run-1" });
    await spend(6, { workflowId: "wf-1", runId: "run-2" });
    await spend(3, { workflowId: "wf-2", runId: "run-3" });

    const spent = await spentThisMonthByWorkflow(orgA.admin.ctx, ["wf-1", "wf-2", "wf-3"]);

    expect(Object.fromEntries(spent)).toEqual({ "wf-1": 10, "wf-2": 3, "wf-3": 0 });
  });

  it("leaves out Try it, anything a run didn't spend, and other workflows", async () => {
    const { orgA, spend } = await funded();
    await spend(5, { workflowId: "wf-1", runId: "run-1" });
    // Try it on the workflow, a call about it outside a run, memory, and another workflow.
    await spend(50, { workflowId: "wf-1", dryRun: true });
    await spend(50, { workflowId: "wf-1" });
    await spend(50, { purpose: "memory" });
    await spend(50, { workflowId: "wf-2", runId: "run-2" });

    const spent = await spentThisMonthByWorkflow(orgA.admin.ctx, ["wf-1"]);

    expect(Object.fromEntries(spent)).toEqual({ "wf-1": 5 });
  });

  it("starts again from zero when the next month starts, in UTC", async () => {
    const { orgA, spend } = await funded();
    await spend(5, { workflowId: "wf-1", runId: "run-1" });
    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    // The last moment of this month still counts it; the first of the next doesn't.
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);
    expect((await spentThisMonthByWorkflow(orgA.admin.ctx, ["wf-1"])).get("wf-1")).toBe(5);

    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    expect((await spentThisMonthByWorkflow(orgA.admin.ctx, ["wf-1"])).get("wf-1")).toBe(0);
  });

  it("is for admins and jobs, never a member", async () => {
    const { orgA, system } = await funded();

    await expect(spentThisMonthByWorkflow(orgA.member.ctx, ["wf-1"])).rejects.toThrow(
      ForbiddenError,
    );
    expect(await spentThisMonthByWorkflow(system, [])).toEqual(new Map());
  });

  it("makes one query however many workflows it adds up", async () => {
    const { orgA, spend } = await funded();
    const ids = Array.from({ length: 20 }, (_, n) => `wf-${String(n)}`);
    for (const id of ids) await spend(1, { workflowId: id, runId: `run-${id}` });

    const one = await countQueries(() => spentThisMonthByWorkflow(orgA.admin.ctx, ids.slice(0, 1)));
    const twenty = await countQueries(() => spentThisMonthByWorkflow(orgA.admin.ctx, ids));

    expect(one.queries).toBe(1);
    expect(twenty.queries).toBe(one.queries);
  });
});

describe("budgetsReached", () => {
  it("names the workflows whose live usage this month is at or over their budget", async () => {
    const { orgA, spend } = await funded();
    await spend(10, { workflowId: "at", runId: "run-1" });
    await spend(9, { workflowId: "under", runId: "run-2" });
    await spend(12, { workflowId: "over", runId: "run-3" });
    // Try it doesn't count, so this one is under its budget too.
    await spend(50, { workflowId: "tried", dryRun: true });
    const budgets = new Map([
      ["at", 10],
      ["under", 10],
      ["over", 10],
      ["tried", 10],
      ["unused", 10],
    ]);

    // Anyone may ask: it says only what members are shown ("Paused: budget reached").
    const reached = await budgetsReached(orgA.member.ctx, budgets);

    expect([...reached].sort()).toEqual(["at", "over"]);
  });

  it("reads nothing when no workflow has a budget", async () => {
    const { orgA } = await funded();

    const read = await countQueries(() => budgetsReached(orgA.member.ctx, new Map()));

    expect(read.queries).toBe(0);
  });
});

describe("budgetsReachedOn", () => {
  /** The start of today, UTC: the day every entry a test records falls on. */
  const today = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  };

  it("gives each workflow at or over its budget this month the UTC day it reached it", async () => {
    const { orgA, spend } = await funded();
    await spend(4, { workflowId: "over", runId: "run-1" });
    await spend(8, { workflowId: "over", runId: "run-2" });
    await spend(10, { workflowId: "at", runId: "run-3" });
    await spend(9, { workflowId: "under", runId: "run-4" });
    // Try it doesn't count.
    await spend(50, { workflowId: "tried", dryRun: true });
    const budgets = new Map([
      ["over", 10],
      ["at", 10],
      ["under", 10],
      ["tried", 10],
    ]);

    const reached = await budgetsReachedOn(orgA.admin.ctx, budgets);

    expect(Object.fromEntries(reached)).toEqual({ over: today(), at: today() });
  });

  it("forgets last month's spending once the next month starts, in UTC", async () => {
    const { orgA, spend } = await funded();
    await spend(12, { workflowId: "wf-1", runId: "run-1" });
    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    expect(await budgetsReachedOn(orgA.admin.ctx, new Map([["wf-1", 10]]))).toEqual(new Map());
  });

  it("is for admins and jobs, and reads nothing when no workflow has a budget", async () => {
    const { orgA, system } = await funded();

    await expect(budgetsReachedOn(orgA.member.ctx, new Map([["wf-1", 10]]))).rejects.toThrow(
      ForbiddenError,
    );
    const read = await countQueries(() => budgetsReachedOn(system, new Map()));
    expect(read.queries).toBe(0);
  });

  it("makes one query however many workflows have budgets", async () => {
    const { orgA, spend } = await funded();
    const ids = Array.from({ length: 20 }, (_, n) => `wf-${String(n)}`);
    for (const id of ids) await spend(2, { workflowId: id, runId: `run-${id}` });
    const budgets = (some: string[]) => new Map(some.map((id) => [id, 1]));

    const one = await countQueries(() =>
      budgetsReachedOn(orgA.admin.ctx, budgets(ids.slice(0, 1))),
    );
    const twenty = await countQueries(() => budgetsReachedOn(orgA.admin.ctx, budgets(ids)));

    expect(one.queries).toBe(1);
    expect(twenty.queries).toBe(one.queries);
  });
});
