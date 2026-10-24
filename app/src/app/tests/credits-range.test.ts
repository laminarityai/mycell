// The Credits page over a chosen range: each preset and a custom range show the ledger's figures
// for exactly their UTC days, a range reaching before the org's first entry or into the future
// is clamped, and a 12-month range reads in the same queries as a month. The ledger's entries are
// made now, so the fake clock moves the page on from them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { CreditsOverview } from "@/features/credits/ui";
import { DAY_MS, type RangeChoice } from "@/features/credits/types";
import { loadCreditsPage } from "../credits/credits-data";
import { orgWithManyWorkflows, orgWithWorkflows, textOf } from "./credits-org";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
const dayParam = (at: Date) => at.toISOString().slice(0, 10);

/** Noon (UTC) on the 10th, `months` months after `at`'s month. */
const monthsLater = (at: Date, months: number) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 10, 12));

/** Sets the clock to `now` and loads the page for `choice`. */
async function pageAt(
  admin: Parameters<typeof loadCreditsPage>[0],
  now: Date,
  choice: RangeChoice,
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return loadCreditsPage(admin, new Date(), choice);
}

const figures = (page: Awaited<ReturnType<typeof loadCreditsPage>>) => ({
  spent: page.summary.spent,
  granted: page.summary.granted,
  entries: page.entries.length,
});

describe("the Credits page's range", () => {
  it("shows last month's figures once the month is over, and nothing for this month yet", async () => {
    const { admin, quotes } = await orgWithWorkflows();
    const made = new Date();
    const now = monthsLater(made, 1);

    const last = await pageAt(admin, now, { preset: "last_month" });
    expect(figures(last)).toEqual({ spent: 40, granted: 1000, entries: 4 });
    // It starts on the day of the org's first entry, and runs to the month's last day.
    expect(last.chosen.first).toEqual(startOfDay(made));
    expect(last.chosen.last).toEqual(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - DAY_MS),
    );
    // A past month says when a workflow reached its budget, not that it's paused now.
    const quoteLine = last.workflows.find((line) => line.workflowId === quotes);
    expect(quoteLine).toMatchObject({ spent: 25, budgetReached: false });
    expect(quoteLine?.reachedOn).toEqual([startOfDay(made)]);

    const current = await pageAt(admin, now, { preset: "this_month" });
    expect(figures(current)).toEqual({ spent: 0, granted: 0, entries: 0 });
    expect(current.summary.openingBalance).toBeCloseTo(960);
    // A new month: nothing spent against its budget, so it isn't paused.
    expect(current.workflows.find((line) => line.workflowId === quotes)).toMatchObject({
      spent: 0,
      budgetReached: false,
    });
  });

  it("counts the month in the last 3 and 12 months until it falls out of them", async () => {
    const { admin } = await orgWithWorkflows();
    const made = new Date();

    expect(figures(await pageAt(admin, monthsLater(made, 2), { preset: "3m" }))).toMatchObject({
      spent: 40,
    });
    expect(figures(await pageAt(admin, monthsLater(made, 3), { preset: "3m" }))).toMatchObject({
      spent: 0,
    });
    const year = await pageAt(admin, monthsLater(made, 11), { preset: "12m" });
    expect(figures(year)).toEqual({ spent: 40, granted: 1000, entries: 4 });
    expect(year.summary.days.length).toBeGreaterThan(300);
    expect(figures(await pageAt(admin, monthsLater(made, 12), { preset: "12m" }))).toMatchObject({
      spent: 0,
      entries: 0,
    });
  });

  it("counts a custom range's UTC days exactly, both ends included", async () => {
    const { admin } = await orgWithWorkflows();
    const made = startOfDay(new Date());
    const day = (n: number) => dayParam(new Date(made.getTime() + n * DAY_MS));
    const now = new Date(made.getTime() + 5 * DAY_MS + 3_600_000);
    const custom = (from: string, to: string) => pageAt(admin, now, { preset: "custom", from, to });

    expect(figures(await custom(day(0), day(0)))).toEqual({ spent: 40, granted: 1000, entries: 4 });
    expect(figures(await custom(day(1), day(3)))).toEqual({ spent: 0, granted: 0, entries: 0 });
    // The day before the entries is before the org's history: the range starts on their day.
    const early = await custom(day(-1), day(2));
    expect(early.chosen.first).toEqual(made);
    expect(figures(early)).toMatchObject({ spent: 40 });
  });

  it("clamps a range reaching into the future to today, never an error", async () => {
    const { admin } = await orgWithWorkflows();
    const made = startOfDay(new Date());
    const now = new Date(made.getTime() + 2 * DAY_MS + 3_600_000);

    const page = await pageAt(admin, now, {
      preset: "custom",
      from: dayParam(made),
      to: "2999-12-31",
    });

    expect(page.chosen.last).toEqual(startOfDay(now));
    expect(page.summary.days).toHaveLength(3);
    expect(figures(page)).toMatchObject({ spent: 40 });
    expect(
      (await pageAt(admin, now, { preset: "custom", from: "2999-01-01", to: "2999-02-01" })).chosen,
    ).toMatchObject({ first: startOfDay(now), last: startOfDay(now) });
  });

  it("writes the range out, and says what the balance and runway are now", async () => {
    const { admin } = await orgWithWorkflows();
    const page = await pageAt(admin, monthsLater(new Date(), 1), { preset: "last_month" });

    const text = textOf(renderToStaticMarkup(createElement(CreditsOverview, page)));

    expect(text).toContain("Balance now 960");
    expect(text).toContain("Spent last month 40");
    expect(text).toContain("Granted last month 1,000");
    // From the first entry's day to the month's end: one day when that was the month's last.
    expect(text).toMatch(/Entries, \w{3} \d{1,2}, \d{4}( – \w{3} \d{1,2}, \d{4})?/);
    // A past range shows when a workflow reached its budget, and no pause.
    expect(text).toContain("Reached its budget on");
    expect(text).not.toContain("Paused: budget reached");
  });

  it("plots months by the month and a quarter by the week, each workflow a row of months", async () => {
    const { admin } = await orgWithWorkflows();
    const made = new Date();
    const render = (
      page: Awaited<ReturnType<typeof loadCreditsPage>>,
      lens: "kinds" | "workflows",
    ) => renderToStaticMarkup(createElement(CreditsOverview, { ...page, lens }));

    const year = await pageAt(admin, monthsLater(made, 11), { preset: "12m" });
    expect(render(year, "kinds")).toContain("Credits spent each month, stacked by kind of use");
    const rows = textOf(render(year, "workflows"));
    expect(rows).toContain("Each workflow, month by month, against its budget");
    expect(rows).toMatch(/Quote replies {2}25 in this range, reached its budget \w{3} \d{1,2}/);
    expect(rows).toContain("Budget 20 a month");
    // Spent in the range, and when it reached its budget, or that it stayed under or had none.
    expect(rows).toMatch(/Quote repliesReached its budget on \w{3} \d{1,2}, \d{4}25/);
    expect(rows).toContain("InvoicesStayed under its budget5");
    expect(rows).toContain("Call notesNo budget10");

    // From the first entry's day to the 28th, two months on: 57 days at least, so by the week.
    const quarter = await pageAt(
      admin,
      new Date(Date.UTC(made.getUTCFullYear(), made.getUTCMonth() + 2, 28, 12)),
      { preset: "3m" },
    );
    expect(render(quarter, "kinds")).toContain("Credits spent each week, stacked by kind of use");
  });

  it("reads a 12-month range in the same queries as a month, for 1 workflow or 20", async () => {
    const few = await orgWithManyWorkflows(1);
    const now = monthsLater(new Date(), 11);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const month = await countQueries(() => loadCreditsPage(few, now, { preset: "this_month" }));
    const one = await countQueries(() => loadCreditsPage(few, now, { preset: "12m" }));
    vi.useRealTimers();
    await resetDatabase();
    const many = await orgWithManyWorkflows(20);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const twenty = await countQueries(() => loadCreditsPage(many, now, { preset: "12m" }));

    expect(one.queries).toBe(month.queries);
    expect(twenty.queries).toBe(one.queries);
  });
});
