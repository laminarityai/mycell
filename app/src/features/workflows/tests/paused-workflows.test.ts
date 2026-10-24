// The workflows an admin's alerts name (M8): those paused for failing, since their pause, and
// those whose live runs reached their budget this month, from the day they did. Archived ones
// stop everywhere anyway, so none of them is listed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { recordUsage } from "@/features/credits/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import {
  archiveWorkflow,
  getWorkflow,
  listPausedWorkflows,
  pauseForFailures,
  publishWorkflow,
  resumeWorkflow,
  saveWorkflow,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const RUNS = ["run-3", "run-2", "run-1"];

/** The start of today, UTC: the day every entry a test records falls on. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Org A's admin, who can publish label workflows. */
async function adminOfOrgA() {
  const { orgA } = await seedTwoOrgs();
  await connectGmail(orgA.admin.ctx, orgA.admin.email);
  return { orgA, admin: orgA.admin.ctx };
}

/** Publishes a label workflow called `name`, with a monthly budget if one is given. */
async function publish(admin: Ctx, name: string, monthlyCredits?: number): Promise<string> {
  const budget = monthlyCredits === undefined ? {} : { budget: { monthlyCredits } };
  const spec = labelSpec({ id: name.toLowerCase().replaceAll(" ", "-"), ...budget });
  const { id } = await saveWorkflow(admin, { name, spec });
  await publishWorkflow(admin, id);
  return id;
}

/** What the workflow's live runs spend this month: `credits`, as a run's model call records it. */
async function spend(orgId: string, workflowId: string, credits: number) {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    workflowId,
    runId: `run-${workflowId}`,
  });
}

describe("listPausedWorkflows", () => {
  it("lists a workflow paused for failing, with its pause, until it's resumed", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publish(admin, "Labels");
    await publish(admin, "Untroubled");
    await pauseForFailures(systemCtx(orgA.id), id, RUNS);
    const { failurePause } = await getWorkflow(admin, id);

    expect(await listPausedWorkflows(admin)).toEqual([
      { id, name: "Labels", failurePause, budgetReached: null },
    ]);
    expect(failurePause).toEqual({ pausedAt: expect.any(Date) as Date, runIds: RUNS });

    await resumeWorkflow(admin, id);

    expect(await listPausedWorkflows(admin)).toEqual([]);
  });

  it("lists a workflow at its budget, from the day it reached it, until the budget is raised", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publish(admin, "Labels", 10);
    const under = await publish(admin, "Under", 10);
    await spend(orgA.id, id, 10);
    await spend(orgA.id, under, 9);

    expect(await listPausedWorkflows(admin)).toEqual([
      {
        id,
        name: "Labels",
        failurePause: null,
        budgetReached: { monthlyCredits: 10, reachedOn: today() },
      },
    ]);

    await saveWorkflow(admin, {
      workflowId: id,
      name: "Labels",
      spec: labelSpec({ id: "labels", budget: { monthlyCredits: 20 } }),
    });
    await publishWorkflow(admin, id);

    expect(await listPausedWorkflows(admin)).toEqual([]);
  });

  it("stops listing a budget reached once the next month starts, in UTC", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publish(admin, "Labels", 10);
    await spend(orgA.id, id, 12);
    expect(await listPausedWorkflows(admin)).toHaveLength(1);

    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    expect(await listPausedWorkflows(admin)).toEqual([]);
  });

  it("gives both on a workflow that's failing and at its budget, by name", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const both = await publish(admin, "Quotes", 5);
    const failing = await publish(admin, "Labels");
    await spend(orgA.id, both, 5);
    await pauseForFailures(systemCtx(orgA.id), both, RUNS);
    await pauseForFailures(systemCtx(orgA.id), failing, RUNS);

    const paused = await listPausedWorkflows(admin);

    expect(paused.map((workflow) => workflow.name)).toEqual(["Labels", "Quotes"]);
    expect(paused[1]).toMatchObject({
      failurePause: { runIds: RUNS },
      budgetReached: { monthlyCredits: 5 },
    });
  });

  it("leaves out an archived workflow, however it's paused", async () => {
    const { orgA, admin } = await adminOfOrgA();
    const id = await publish(admin, "Labels", 5);
    await spend(orgA.id, id, 5);
    await pauseForFailures(systemCtx(orgA.id), id, RUNS);

    await archiveWorkflow(admin, id);

    expect(await listPausedWorkflows(admin)).toEqual([]);
  });

  it("is for admins, never a member", async () => {
    const { orgA } = await adminOfOrgA();

    await expect(listPausedWorkflows(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });

  it("makes the same queries for 1 paused workflow of each kind as for 10", async () => {
    const pausedOrg = async (count: number) => {
      const { orgA, admin } = await adminOfOrgA();
      await publish(admin, "Untroubled", 100);
      for (let n = 0; n < count; n += 1) {
        await pauseForFailures(
          systemCtx(orgA.id),
          await publish(admin, `Failing ${String(n)}`),
          RUNS,
        );
        await spend(orgA.id, await publish(admin, `Spent ${String(n)}`, 1), 1);
      }
      return admin;
    };
    const one = await pausedOrg(1);
    expect(await listPausedWorkflows(one)).toHaveLength(2);
    const few = await countQueries(() => listPausedWorkflows(one));
    await resetDatabase();
    const ten = await pausedOrg(10);
    expect(await listPausedWorkflows(ten)).toHaveLength(20);
    const many = await countQueries(() => listPausedWorkflows(ten));

    // The workflows, their latest versions, and the budgeted ones' spending by day.
    expect(few.queries).toBe(3);
    expect(many.queries).toBe(few.queries);
  });
});
