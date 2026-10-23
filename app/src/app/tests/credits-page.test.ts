// The Credits page: this month's spending by workflow next to each one's budget, the latest
// entries with their workflows' names and grants' notes, read in the same queries for 1
// workflow as for 20.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, recordUsage } from "@/features/credits/server";
import { CreditsOverview } from "@/features/credits/ui";
import { archiveWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { loadCreditsPage } from "../credits/credits-data";

beforeEach(resetDatabase);

const labelSpec = (id: string, monthlyCredits?: number) => ({
  specVersion: 1,
  id,
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ],
  autonomy: { rung: 3 },
  ...(monthlyCredits === undefined ? {} : { budget: { monthlyCredits } }),
});

async function publish(admin: Ctx, name: string, id: string, monthlyCredits?: number) {
  const saved = await saveWorkflow(admin, { name, spec: labelSpec(id, monthlyCredits) });
  await publishWorkflow(admin, saved.id);
  return saved.id;
}

/** A run's model call that cost `credits`, as the gateway client records it. */
async function run(orgId: string, workflowId: string, credits: number, runId = "run_1") {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    workflowId,
    runId,
  });
}

/** Org A with four workflows, three of which ran this month, one past its budget. */
async function orgWithWorkflows() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
  const quotes = await publish(admin, "Quote replies", "quotes", 20);
  const invoices = await publish(admin, "Invoices", "invoices", 500);
  const calls = await publish(admin, "Call notes", "calls");
  const idle = await publish(admin, "Status updates", "status", 100);
  const archived = await publish(admin, "Old", "old", 100);
  await archiveWorkflow(admin, archived);
  await run(orgA.id, quotes, 25);
  await run(orgA.id, invoices, 5);
  await run(orgA.id, calls, 10);
  return { admin, idle };
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

describe("the Credits page", () => {
  it("shows each workflow's spending next to its budget, and marks one that reached it", async () => {
    const { admin, idle } = await orgWithWorkflows();

    const page = await loadCreditsPage(admin, new Date());

    expect(
      page.workflows.map(({ name, spent, monthlyBudget, budgetReached }) => ({
        name,
        spent,
        monthlyBudget,
        budgetReached,
      })),
    ).toEqual([
      { name: "Quote replies", spent: 25, monthlyBudget: 20, budgetReached: true },
      { name: "Call notes", spent: 10, monthlyBudget: null, budgetReached: false },
      { name: "Invoices", spent: 5, monthlyBudget: 500, budgetReached: false },
      { name: "Status updates", spent: 0, monthlyBudget: 100, budgetReached: false },
    ]);
    expect(page.workflows.find((line) => line.workflowId === idle)?.daily).toHaveLength(
      page.summary.days.length,
    );
    expect(page.summary).toMatchObject({ spent: 40, granted: 1000 });
    expect(page.runway.balance).toBeCloseTo(960);
    expect(
      page.entries.map(({ kind, workflowName, note }) => ({ kind, workflowName, note })),
    ).toEqual([
      { kind: "usage", workflowName: "Call notes", note: null },
      { kind: "usage", workflowName: "Invoices", note: null },
      { kind: "usage", workflowName: "Quote replies", note: null },
      { kind: "grant", workflowName: null, note: "October allowance" },
    ]);
  });

  it("renders the balance and runway, each workflow against its budget, and the grant's note", async () => {
    const { admin } = await orgWithWorkflows();

    const html = renderToStaticMarkup(
      createElement(CreditsOverview, await loadCreditsPage(admin, new Date())),
    );

    const text = textOf(html);
    expect(text).toContain("Balance 960");
    // 40 credits in the last 7 days: about 5.7 a day.
    expect(text).toMatch(/Lasts about 168 days \(to \w{3} \d{1,2}, \d{4}, at 5\.7 a day\)/);
    expect(text).toContain("Spent this month 40");
    expect(text).toContain("Granted this month 1,000");
    expect(text).toContain("Quote repliesPaused: budget reached25 / 20");
    expect(text).toContain("Call notesno budget10");
    expect(text).toContain("Status updates");
    expect(text).toContain("October allowance");
    expect(text).not.toContain("Old");
  });

  it("plots spending by kind, and each workflow's running total against its budget", async () => {
    const { admin } = await orgWithWorkflows();
    const page = await loadCreditsPage(admin, new Date());
    const render = (lens: "kinds" | "workflows") =>
      renderToStaticMarkup(createElement(CreditsOverview, { ...page, lens }));

    expect(render("kinds")).toContain("Credits spent each day, stacked by kind of use");
    const workflows = render("workflows");
    expect(workflows).toContain("Budget 20");
    expect(workflows).toContain("Quote replies reached its budget and paused");
    expect(workflows).not.toContain("Invoices reached its budget");
  });

  it("says there's no runway with no usage this week, and no workflow spending", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 1000, "Trial");

    const text = textOf(
      renderToStaticMarkup(
        createElement(CreditsOverview, await loadCreditsPage(orgA.admin.ctx, new Date())),
      ),
    );

    expect(text).toContain("No usage in the last 7 days");
    expect(text).toContain("No workflow has spent any credits.");
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(loadCreditsPage(orgA.member.ctx, new Date())).rejects.toThrow(ForbiddenError);
  });

  it("reads 1 workflow's spending or 20's in the same queries", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
    const add = async (n: number) => {
      const id = await publish(admin, `Workflow ${String(n)}`, `wf-${String(n)}`, 100);
      await run(orgA.id, id, 2, `run_${String(n)}_a`);
      await run(orgA.id, id, 3, `run_${String(n)}_b`);
    };
    await add(0);
    const one = await countQueries(() => loadCreditsPage(admin, new Date()));
    for (let n = 1; n < 20; n += 1) await add(n);
    const twenty = await countQueries(() => loadCreditsPage(admin, new Date()));

    expect(one.queries).toBe(7);
    expect(twenty.queries).toBe(one.queries);
  });
});
