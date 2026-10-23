// The Credits page: this month's spending by workflow next to each one's budget, the entries
// with their workflows' names and grants' notes, read in the same queries for 1 workflow as for
// 20. Other ranges are in credits-range.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { CreditsOverview } from "@/features/credits/ui";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { loadCreditsPage } from "../credits/credits-data";
import { orgWithManyWorkflows, orgWithWorkflows, textOf } from "./credits-org";

beforeEach(resetDatabase);

describe("the Credits page", () => {
  it("shows each workflow's spending next to its budget, and marks one that reached it", async () => {
    const { admin, idle } = await orgWithWorkflows();

    const page = await loadCreditsPage(admin, new Date());

    expect(page.chosen.preset).toBe("this_month");
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
    expect(page.moreEntries).toBe(false);
  });

  it("renders the balance and runway now, each workflow against its budget, and the grant's note", async () => {
    const { admin } = await orgWithWorkflows();

    const html = renderToStaticMarkup(
      createElement(CreditsOverview, await loadCreditsPage(admin, new Date())),
    );

    const text = textOf(html);
    expect(text).toContain("Balance now 960");
    // 40 credits in the last 7 days: about 5.7 a day.
    expect(text).toMatch(
      /From today, lasts about 168 days \(to \w{3} \d{1,2}, \d{4}, at 5\.7 a day\)/,
    );
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
    expect(text).toContain("No workflow has spent any credits in this range.");
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(loadCreditsPage(orgA.member.ctx, new Date())).rejects.toThrow(ForbiddenError);
  });

  it("reads 1 workflow's spending or 20's in the same queries", async () => {
    const few = await orgWithManyWorkflows(1);
    const one = await countQueries(() => loadCreditsPage(few, new Date()));
    await resetDatabase();
    const many = await orgWithManyWorkflows(20);
    const twenty = await countQueries(() => loadCreditsPage(many, new Date()));

    // The runway (2), the first entry, the range's sums (2), its entries, and the budgets (2).
    expect(one.queries).toBe(8);
    expect(twenty.queries).toBe(one.queries);
  });
});
