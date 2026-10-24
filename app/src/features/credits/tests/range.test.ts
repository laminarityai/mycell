// The Credits page's date range: what each preset and a custom pick cover (whole UTC days, kept
// inside the org's history and never past today), how the address is read back, and what the
// page works out over a range: spending by day, week or month, and each workflow's month.
import { describe, expect, it } from "vitest";
import {
  budgetReachedOn,
  bucketUnit,
  includesNow,
  monthToDate,
  resolveRange,
  spendingBuckets,
} from "../range";
import { creditsQuerySchema, daysOf, type DailySpending, type RangeChoice } from "../types";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (at: Date) => at.toISOString().slice(0, 10);

/** The first and last day a choice covers, as "2026-10-01". */
function covered(choice: RangeChoice | RangeChoice["preset"], now: string, start?: string) {
  const picked = typeof choice === "string" ? { preset: choice } : choice;
  const chosen = resolveRange(
    picked,
    new Date(now),
    start === undefined ? new Date("2020-01-01T09:00:00Z") : start === "" ? null : new Date(start),
  );
  // The range runs from the first day's start to the day after the last.
  expect(chosen.range).toEqual({
    from: chosen.first,
    to: new Date(chosen.last.getTime() + 24 * 60 * 60 * 1000),
  });
  return [day(chosen.first), day(chosen.last)];
}

describe("a preset's days", () => {
  const now = "2026-10-23T15:00:00Z";

  it("runs this month from the 1st through today", () => {
    expect(covered("this_month", now)).toEqual(["2026-10-01", "2026-10-23"]);
  });

  it("covers the whole of last month", () => {
    expect(covered("last_month", now)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(covered("last_month", "2028-03-10T12:00:00Z")).toEqual(["2028-02-01", "2028-02-29"]);
  });

  it("starts the last 3 and 12 months on the 1st, since budgets and grants are monthly", () => {
    expect(covered("3m", now)).toEqual(["2026-08-01", "2026-10-23"]);
    expect(covered("12m", now)).toEqual(["2025-11-01", "2026-10-23"]);
  });

  it("crosses into the year before in January", () => {
    const january = "2026-01-05T08:00:00Z";
    expect(covered("this_month", january)).toEqual(["2026-01-01", "2026-01-05"]);
    expect(covered("last_month", january)).toEqual(["2025-12-01", "2025-12-31"]);
    expect(covered("3m", january)).toEqual(["2025-11-01", "2026-01-05"]);
    expect(covered("12m", january)).toEqual(["2025-02-01", "2026-01-05"]);
  });

  it("follows the UTC day, not the reader's: late on Oct 31 in California is already November", () => {
    expect(covered("this_month", "2026-10-31T23:30:00-07:00")).toEqual([
      "2026-11-01",
      "2026-11-01",
    ]);
    expect(covered("last_month", "2026-10-31T23:30:00-07:00")).toEqual([
      "2026-10-01",
      "2026-10-31",
    ]);
    expect(covered("this_month", "2026-10-31T23:59:59.999Z")).toEqual(["2026-10-01", "2026-10-31"]);
    expect(covered("this_month", "2026-11-01T00:00:00Z")).toEqual(["2026-11-01", "2026-11-01"]);
    // Early on Nov 1 in Kiribati (UTC+14) is still October in UTC.
    expect(covered("this_month", "2026-11-01T10:00:00+14:00")).toEqual([
      "2026-10-01",
      "2026-10-31",
    ]);
  });
});

describe("a custom range's days", () => {
  const now = "2026-10-23T15:00:00Z";
  const custom = (from?: string, to?: string): RangeChoice => ({ preset: "custom", from, to });

  it("covers its first and last days, both included", () => {
    expect(covered(custom("2026-09-03", "2026-10-10"), now)).toEqual(["2026-09-03", "2026-10-10"]);
    expect(covered(custom("2026-10-10", "2026-10-10"), now)).toEqual(["2026-10-10", "2026-10-10"]);
  });

  it("swaps ends given the wrong way round", () => {
    expect(covered(custom("2026-10-10", "2026-09-03"), now)).toEqual(["2026-09-03", "2026-10-10"]);
  });

  it("falls back to this month's 1st and today for a missing or impossible day", () => {
    expect(covered(custom(), now)).toEqual(["2026-10-01", "2026-10-23"]);
    expect(covered(custom("2026-02-30", "2026-10-05"), now)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(covered(custom("2026-10-05", "soon"), now)).toEqual(["2026-10-05", "2026-10-23"]);
  });
});

describe("clamping a range to the org's history", () => {
  const now = "2026-10-23T15:00:00Z";
  // The org's first ledger entry, mid-month.
  const start = "2026-10-15T22:30:00Z";

  it("starts no earlier than the day of the org's first entry", () => {
    expect(covered("this_month", now, start)).toEqual(["2026-10-15", "2026-10-23"]);
    expect(covered("12m", now, start)).toEqual(["2026-10-15", "2026-10-23"]);
    expect(covered({ preset: "custom", from: "1999-01-01", to: "2026-10-20" }, now, start)).toEqual(
      ["2026-10-15", "2026-10-20"],
    );
  });

  it("ends no later than today", () => {
    expect(covered({ preset: "custom", from: "2026-10-18", to: "2099-12-31" }, now, start)).toEqual(
      ["2026-10-18", "2026-10-23"],
    );
    expect(covered({ preset: "custom", from: "2027-01-01", to: "2027-02-01" }, now, start)).toEqual(
      ["2026-10-23", "2026-10-23"],
    );
  });

  it("shrinks a range wholly before the first entry to its day, and one with no entries to today", () => {
    expect(covered("last_month", now, start)).toEqual(["2026-10-15", "2026-10-15"]);
    expect(covered("12m", now, "")).toEqual(["2026-10-23", "2026-10-23"]);
  });

  it("keeps the bounds a custom pick may choose between", () => {
    const chosen = resolveRange({ preset: "3m" }, new Date(now), new Date(start));
    expect(chosen).toMatchObject({
      preset: "3m",
      earliest: utc("2026-10-15"),
      today: utc(day(new Date(now))),
    });
  });
});

describe("reading the range from the address", () => {
  it("is this month unless it names a preset", () => {
    expect(creditsQuerySchema.parse({})).toEqual({ preset: "this_month" });
    expect(creditsQuerySchema.parse({ range: "3m" })).toEqual({ preset: "3m" });
    expect(creditsQuerySchema.parse({ range: "forever" })).toEqual({ preset: "this_month" });
    expect(creditsQuerySchema.parse({ range: ["last_month", "12m"] })).toEqual({
      preset: "last_month",
    });
  });

  it("keeps a custom range's days, and leaves out one that isn't a day", () => {
    expect(
      creditsQuerySchema.parse({ range: "custom", from: "2026-09-03", to: "2026-10-10" }),
    ).toEqual({ preset: "custom", from: "2026-09-03", to: "2026-10-10" });
    expect(creditsQuerySchema.parse({ range: "custom", from: "Sep 3", to: "" })).toEqual({
      preset: "custom",
      from: undefined,
      to: undefined,
    });
    // A preset ignores days left in the address.
    expect(creditsQuerySchema.parse({ range: "12m", from: "2026-09-03" })).toEqual({
      preset: "12m",
    });
  });
});

/** A range's days, each spending `spent(i)` on workflows and 1 on memory. */
function daysSpending(from: string, to: string, spent = (i: number) => i + 1): DailySpending[] {
  return daysOf({ from: utc(from), to: utc(to) }).map((at, i) => ({
    day: at,
    byKind: { workflow: spent(i), memory: 1, builder: 0, agent: 0, try_it: 0 },
    spent: spent(i) + 1,
    granted: 0,
  }));
}

describe("bucketing spending by the range's length", () => {
  it("is by day up to 45 days, by week up to about 4 months, then by month", () => {
    expect(bucketUnit(1)).toBe("day");
    expect(bucketUnit(45)).toBe("day");
    expect(bucketUnit(46)).toBe("week");
    expect(bucketUnit(92)).toBe("week");
    expect(bucketUnit(125)).toBe("week");
    expect(bucketUnit(126)).toBe("month");
    expect(bucketUnit(366)).toBe("month");
  });

  it("splits weeks from the range's first day, the last one short", () => {
    // Aug 1 to Oct 24: 85 days, 12 whole weeks and a day.
    const days = daysSpending("2026-08-01", "2026-10-25");
    const buckets = spendingBuckets(days);

    expect(buckets).toHaveLength(13);
    expect([day(buckets[0]?.from ?? new Date()), buckets[0]?.days]).toEqual(["2026-08-01", 7]);
    expect([day(buckets[1]?.from ?? new Date()), buckets[1]?.first]).toEqual(["2026-08-08", 7]);
    expect(buckets.at(-1)).toMatchObject({ from: utc("2026-10-24"), first: 84, days: 1 });
    expect(buckets.reduce((sum, b) => sum + b.spent, 0)).toBe(
      days.reduce((sum, d) => sum + d.spent, 0),
    );
    expect(buckets[0]?.byKind).toEqual({
      workflow: 28,
      memory: 7,
      builder: 0,
      agent: 0,
      try_it: 0,
    });
  });

  it("splits months on the 1st, the first and last ones partial", () => {
    const days = daysSpending("2025-11-15", "2026-10-24", () => 2);
    const buckets = spendingBuckets(days);

    expect(buckets.map((b) => [day(b.from), b.days])).toEqual([
      ["2025-11-15", 16],
      ["2025-12-01", 31],
      ["2026-01-01", 31],
      ["2026-02-01", 28],
      ["2026-03-01", 31],
      ["2026-04-01", 30],
      ["2026-05-01", 31],
      ["2026-06-01", 30],
      ["2026-07-01", 31],
      ["2026-08-01", 31],
      ["2026-09-01", 30],
      ["2026-10-01", 23],
    ]);
    expect(buckets[3]).toMatchObject({ spent: 84, byKind: { workflow: 56, memory: 28 } });
  });

  it("keeps each day its own bucket for a month", () => {
    const days = daysSpending("2026-10-01", "2026-10-24");
    expect(spendingBuckets(days).map((b) => b.spent)).toEqual(days.map((d) => d.spent));
  });
});

describe("a workflow's month", () => {
  // Sep 28 to Oct 3, spending 1 to 6 a day, after 10 earlier in September.
  const days = daysSpending("2026-09-28", "2026-10-04").map((d) => d.day);
  const line = { daily: [1, 2, 3, 4, 5, 6], monthBefore: 10 };

  it("runs its total on from what the month spent before the range, starting again on the 1st", () => {
    expect(monthToDate(days, line)).toEqual([11, 13, 16, 4, 9, 15]);
  });

  it("marks each day its month's total reached the budget", () => {
    const totals = monthToDate(days, line);

    expect(budgetReachedOn(days, totals, line.monthBefore, 12).map(day)).toEqual([
      "2026-09-29",
      "2026-10-03",
    ]);
    // Reached before the range began: no mark until the next month reaches it again.
    const reachedEarlier = { ...line, monthBefore: 12 };
    expect(budgetReachedOn(days, monthToDate(days, reachedEarlier), 12, 12).map(day)).toEqual([
      "2026-10-03",
    ]);
    expect(budgetReachedOn(days, totals, line.monthBefore, 100)).toEqual([]);
  });
});

describe("whether a range includes now", () => {
  it("is true only while now falls inside it", () => {
    const range = { from: utc("2026-10-01"), to: utc("2026-10-24") };
    expect(includesNow(range, new Date("2026-10-23T23:59:00Z"))).toBe(true);
    expect(includesNow(range, new Date("2026-10-24T00:00:00Z"))).toBe(false);
    expect(includesNow(range, new Date("2026-09-30T23:59:00Z"))).toBe(false);
  });
});
