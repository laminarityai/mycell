// The Credits page's numbers: spending by kind of use, by workflow and by day, and the runway,
// each checked against the ledger that real metered calls wrote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { getBalance, getRunway, getSpendingSummary, grantCredits, listLedger } from "../server";
import { DAY_MS, monthRange, spendingKindOf, SPENDING_KINDS } from "../types";
import { spend } from "./spend";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

async function orgWithSpending() {
  const orgs = await seedTwoOrgs();
  const ctx = systemCtx(orgs.orgA.id);
  await grantCredits(ctx, 1000, "October allowance");
  await spend(ctx, 10, { workflowId: "wf_1", runId: "run_1" });
  await spend(ctx, 5, { workflowId: "wf_1", runId: "run_2" });
  await spend(ctx, 20, { workflowId: "wf_2", runId: "run_3" });
  // Try it and a builder turn about wf_1 aren't its spending.
  await spend(ctx, 3, { workflowId: "wf_1", dryRun: true });
  await spend(ctx, 4, { purpose: "builder" });
  await spend(ctx, 2, { purpose: "memory" });
  await spend(ctx, 1, { purpose: "memory_summary" });
  return orgs;
}

describe("getSpendingSummary", () => {
  it("splits this month's spending by kind of use and by workflow, as the ledger has it", async () => {
    const { orgA } = await orgWithSpending();

    const summary = await getSpendingSummary(orgA.admin.ctx, monthRange(new Date()));

    expect(summary).toMatchObject({
      openingBalance: 0,
      spent: 45,
      granted: 1000,
      byKind: { workflow: 35, memory: 3, builder: 4, try_it: 3 },
    });
    expect(summary.byWorkflow.map(({ workflowId, spent }) => ({ workflowId, spent }))).toEqual([
      { workflowId: "wf_2", spent: 20 },
      { workflowId: "wf_1", spent: 15 },
    ]);
    // The same totals, added up from the ledger's own entries.
    const ledger = await listLedger(orgA.admin.ctx);
    const usage = ledger.filter((entry) => entry.kind === "usage");
    for (const kind of SPENDING_KINDS) {
      const entries = usage.filter((entry) => spendingKindOf(entry) === kind);
      expect(summary.byKind[kind]).toBeCloseTo(-entries.reduce((sum, e) => sum + e.amount, 0));
    }
    expect(summary.openingBalance + summary.granted - summary.spent).toBeCloseTo(
      await getBalance(orgA.admin.ctx),
    );
  });

  it("puts today's spending on today, and every day of the month in order", async () => {
    const { orgA } = await orgWithSpending();
    const range = monthRange(new Date());

    const { days, byWorkflow } = await getSpendingSummary(orgA.admin.ctx, range);

    const today = days.findIndex((d) => d.day.getTime() === startOfDay(new Date()).getTime());
    expect(days[0]?.day).toEqual(range.from);
    expect(days.length).toBe(Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS));
    expect(days[today]).toEqual({
      day: startOfDay(new Date()),
      byKind: { workflow: 35, memory: 3, builder: 4, try_it: 3 },
      spent: 45,
      granted: 1000,
    });
    expect(days.filter((_, i) => i !== today).every((d) => d.spent === 0)).toBe(true);
    expect(byWorkflow[0]?.daily[today]).toBe(20);
    expect(byWorkflow[0]?.daily.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("counts what came before the range in its opening balance, and nothing in it", async () => {
    const { orgA } = await orgWithSpending();
    const tomorrow = new Date(startOfDay(new Date()).getTime() + DAY_MS);

    const later = await getSpendingSummary(orgA.admin.ctx, {
      from: tomorrow,
      to: new Date(tomorrow.getTime() + 7 * DAY_MS),
    });

    expect(later).toMatchObject({ openingBalance: 955, spent: 0, granted: 0, byWorkflow: [] });
    expect(later.days).toHaveLength(7);
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(getSpendingSummary(orgA.member.ctx, monthRange(new Date()))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("getRunway", () => {
  it("lasts the balance over the last 7 days' average daily usage", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    await grantCredits(ctx, 1000, "October allowance");
    await spend(ctx, 70, { workflowId: "wf_1", runId: "run_1" });

    const before = Date.now();
    const runway = await getRunway(orgA.admin.ctx);

    expect(runway.balance).toBeCloseTo(930);
    expect(runway.dailyRate).toBeCloseTo(10);
    expect(runway.days).toBeCloseTo(93);
    const zeroAt = runway.zeroAt?.getTime() ?? 0;
    expect(zeroAt - before).toBeGreaterThanOrEqual(93 * DAY_MS);
    expect(zeroAt - Date.now()).toBeLessThanOrEqual(93 * DAY_MS);
  });

  it("is none when nothing was used in the last 7 days", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    await grantCredits(ctx, 1000, "October allowance");
    expect(await getRunway(orgA.admin.ctx)).toEqual({
      balance: 1000,
      dailyRate: null,
      days: null,
      zeroAt: null,
    });

    await spend(ctx, 70, { workflowId: "wf_1", runId: "run_1" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * DAY_MS);

    const runway = await getRunway(orgA.admin.ctx);
    expect(runway.balance).toBeCloseTo(930);
    expect(runway).toMatchObject({ dailyRate: null, days: null, zeroAt: null });
  });

  it("has no days left once the balance is gone", async () => {
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    await grantCredits(ctx, 10, "Trial");
    await spend(ctx, 14, { purpose: "builder" });

    const runway = await getRunway(orgA.admin.ctx);
    expect(runway.balance).toBeCloseTo(-4);
    expect(runway.dailyRate).toBeCloseTo(2);
    expect(runway.days).toBe(0);
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(getRunway(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});

describe("listLedger's filters", () => {
  it("lists grants with their notes, and only the kind, workflow or range asked for", async () => {
    const { orgA } = await orgWithSpending();
    const ctx = orgA.admin.ctx;

    expect(await listLedger(ctx, { kind: "grant" })).toMatchObject([
      { kind: "grant", amount: 1000, note: "October allowance" },
    ]);
    expect((await listLedger(ctx, { workflowId: "wf_1" })).map((e) => e.amount)).toEqual([
      -3, -5, -10,
    ]);
    expect(await listLedger(ctx, { limit: 2 })).toHaveLength(2);
    const tomorrow = new Date(startOfDay(new Date()).getTime() + DAY_MS);
    expect(
      await listLedger(ctx, {
        range: { from: tomorrow, to: new Date(tomorrow.getTime() + DAY_MS) },
      }),
    ).toEqual([]);
    expect(await listLedger(ctx, { range: monthRange(new Date()) })).toHaveLength(8);
  });
});
