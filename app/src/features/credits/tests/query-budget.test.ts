// Every model call checks credits first (invariant 7), and the ledger grows by a row per call, so
// the check must cost the same however long the ledger is.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import {
  checkCredits,
  getLedgerStart,
  getRunway,
  getSpendingSummary,
  grantCredits,
  recordUsage,
} from "../server";
import { monthRange } from "../types";

beforeEach(resetDatabase);

describe("checkCredits' query budget", () => {
  it("makes one query that returns one row, whether the ledger has 1 entry or 20", async () => {
    const { orgA } = await seedTwoOrgs();
    const system = systemCtx(orgA.id);
    await grantCredits(system, 100);

    const short = await countQueries(() => checkCredits(orgA.admin.ctx, 1));
    for (let call = 0; call < 19; call += 1) {
      await recordUsage(system, {
        role: "fast",
        modelId: "openai/x",
        costUsd: 0.001,
        outcome: "succeeded",
      });
    }
    const long = await countQueries(() => checkCredits(orgA.admin.ctx, 1));

    expect(short).toEqual({ queries: 1, rows: 1 });
    expect(long).toEqual(short);
  });
});

describe("the Credits page's reads' query budget", () => {
  async function orgWithWorkflows(count: number) {
    const { orgA } = await seedTwoOrgs();
    const system = systemCtx(orgA.id);
    await grantCredits(system, 1000, "October allowance");
    for (let n = 0; n < count; n += 1) {
      for (const run of ["a", "b"]) {
        await recordUsage(system, {
          role: "fast",
          modelId: "openai/x",
          costUsd: 0.001,
          outcome: "succeeded",
          workflowId: `wf_${String(n)}`,
          runId: `run_${String(n)}_${run}`,
        });
      }
    }
    return orgA.admin.ctx;
  }

  it("sums a month's spending in two queries, for 1 workflow or 20", async () => {
    const range = monthRange(new Date());
    const one = await orgWithWorkflows(1);
    const few = await countQueries(() => getSpendingSummary(one, range));
    await resetDatabase();
    const twenty = await orgWithWorkflows(20);
    const many = await countQueries(() => getSpendingSummary(twenty, range));

    expect(few.queries).toBe(2);
    expect(many.queries).toBe(few.queries);
    // One group per workflow and day, not per run or entry: the opening balance, the grant,
    // and each workflow's day.
    expect(few.rows).toBe(3);
    expect(many.rows).toBe(22);
  });

  it("sums 12 months in the same two queries, for 1 workflow or 20", async () => {
    const now = new Date();
    const range = {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
    };
    const one = await orgWithWorkflows(1);
    const few = await countQueries(() => getSpendingSummary(one, range));
    await resetDatabase();
    const twenty = await orgWithWorkflows(20);
    const many = await countQueries(() => getSpendingSummary(twenty, range));

    expect(few.queries).toBe(2);
    expect(many.queries).toBe(few.queries);
    expect(many.rows).toBe(22);
  });

  it("finds the ledger's first entry in one query that returns a row", async () => {
    const ctx = await orgWithWorkflows(20);

    expect(await countQueries(() => getLedgerStart(ctx))).toEqual({ queries: 1, rows: 1 });
  });

  it("reads the runway in two queries that return a row each", async () => {
    const ctx = await orgWithWorkflows(20);

    expect(await countQueries(() => getRunway(ctx))).toEqual({ queries: 2, rows: 2 });
  });
});
