// Each workflow's latest version is read before every run step and on every page that lists
// workflows, so the read must cost the same however many versions a workflow has.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { recordUsage } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { connectGmail, connectMailbox } from "@/testing/connect-helpers";
import {
  currentVersionIds,
  listStartable,
  listSwitchedOn,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { draftSpec, labelSpec } from "./specs";

beforeEach(resetDatabase);

describe("the latest-version read's query budget", () => {
  it("makes one query that returns one row, whether a workflow has 1 version or 10", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Pricing", spec: draftSpec() });
    await publishWorkflow(admin, id);

    const one = await countQueries(() => currentVersionIds(admin, [id]));
    let latest = await publishWorkflow(admin, id);
    while (latest.number < 10) latest = await publishWorkflow(admin, id);
    const ten = await countQueries(() => currentVersionIds(admin, [id]));

    expect(one).toEqual({ queries: 1, rows: 1 });
    expect(ten).toEqual(one);
    expect(await currentVersionIds(admin, [id])).toEqual(new Map([[id, latest.id]]));
  });
});

// A run in progress reads what's switched on for its connection before every step.
describe("what's switched on for a connection: its query budget", () => {
  it("makes the same 3 queries for 1 workflow switched on as for 10", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const own = await connectMailbox(admin, orgA.admin.email);
    const switchOn = async (n: number) => {
      const spec = labelSpec({ id: `labels-${String(n)}` });
      const { id } = await saveWorkflow(admin, { name: `Labels ${String(n)}`, spec });
      await publishWorkflow(admin, id);
      await switchWorkflowOn(admin, id, own.id);
    };
    const system = systemCtx(orgA.id);
    await switchOn(1);

    const one = await countQueries(() => listSwitchedOn(system, own.id));
    for (let n = 2; n <= 10; n += 1) await switchOn(n);
    const ten = await countQueries(() => listSwitchedOn(system, own.id));

    expect(one.queries).toBe(3);
    expect(ten.queries).toBe(one.queries);
    expect(await listSwitchedOn(system, own.id)).toHaveLength(10);
  });
});

// The trigger's fan-out reads what a new message starts for every message that arrives, the
// balance included (out of credits pauses every workflow) and each budgeted workflow's spending
// this month, so it must cost the same however many workflows are switched on, out of credits or
// not, and however many have budgets.
describe("what a new message starts: its query budget", () => {
  it("makes the same queries for 1 workflow switched on as for 20, the balance read once", async () => {
    const { orgA } = await seedTwoOrgs({ credits: 100 });
    const admin = orgA.admin.ctx;
    const own = await connectMailbox(admin, orgA.admin.email);
    const switchOn = async (n: number) => {
      const spec = labelSpec({ id: `labels-${String(n)}` });
      const { id } = await saveWorkflow(admin, { name: `Labels ${String(n)}`, spec });
      await publishWorkflow(admin, id);
      await switchWorkflowOn(admin, id, own.id);
    };
    const system = systemCtx(orgA.id);
    await switchOn(1);

    const one = await countQueries(() => listStartable(system, own.id));
    for (let n = 2; n <= 20; n += 1) await switchOn(n);
    const twenty = await countQueries(() => listStartable(system, own.id));
    expect(await listStartable(system, own.id)).toHaveLength(20);
    // Spending the whole balance: the same queries, and nothing starts.
    await recordUsage(system, { role: "fast", modelId: "x", costUsd: 0.1, outcome: "succeeded" });
    const outOfCredits = await countQueries(() => listStartable(system, own.id));

    // Without a budget anywhere, no spending is read.
    expect(one.queries).toBe(10);
    expect(twenty.queries).toBe(one.queries);
    expect(outOfCredits.queries).toBe(one.queries);
    expect(await listStartable(system, own.id)).toEqual([]);
  });

  it("reads every budgeted workflow's spending in one query, for 1 workflow or 20", async () => {
    const { orgA } = await seedTwoOrgs({ credits: 1000 });
    const admin = orgA.admin.ctx;
    const own = await connectMailbox(admin, orgA.admin.email);
    const system = systemCtx(orgA.id);
    const ids: string[] = [];
    const switchOn = async (n: number) => {
      const spec = labelSpec({ id: `labels-${String(n)}`, budget: { monthlyCredits: 10 } });
      const { id } = await saveWorkflow(admin, { name: `Labels ${String(n)}`, spec });
      await publishWorkflow(admin, id);
      await switchWorkflowOn(admin, id, own.id);
      ids.push(id);
      // Each spends in a live run: under its budget, except the first, which reaches it.
      await recordUsage(system, {
        role: "fast",
        modelId: "x",
        costUsd: n === 1 ? 0.01 : 0.001,
        outcome: "succeeded",
        workflowId: id,
        runId: `run-${String(n)}`,
      });
    };
    await switchOn(1);

    const one = await countQueries(() => listStartable(system, own.id));
    for (let n = 2; n <= 20; n += 1) await switchOn(n);
    const twenty = await countQueries(() => listStartable(system, own.id));

    expect(one.queries).toBe(11);
    expect(twenty.queries).toBe(one.queries);
    const started = (await listStartable(system, own.id)).map((on) => on.workflowId);
    expect(started.sort()).toEqual(ids.slice(1).sort());
  });
});
