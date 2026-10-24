// The Credits page's date range (M7): the days each preset or a custom pick covers, in whole UTC
// days kept inside the org's history, and what the page works out over a range: its spending by
// day, week or month, and each workflow's month against its budget. Pure, so client code may
// import it; the sums themselves are the database's.
import {
  DAY_MS,
  monthRange,
  type ChosenRange,
  type DailySpending,
  type RangeChoice,
  type SpendingByKind,
  SPENDING_KINDS,
  type SpendingRange,
  type SpendingSummary,
  type WorkflowSpending,
  type WorkflowSpendingLine,
} from "./types";

/** The start of the UTC day `at` falls in. */
export const startOfUtcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/** A day as the address and a date input hold it: "2026-10-01". */
export const dayParam = (day: Date) => day.toISOString().slice(0, 10);

/** The 1st of the month `n` months from the one `monthStart` begins. */
const monthsOn = (monthStart: Date, n: number) =>
  new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + n, 1));

/** "2026-10-08" as that UTC day's start; null for anything that isn't a day ("2026-02-30"). */
function parseDay(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || dayParam(day) !== value ? null : day;
}

/**
 * The days a choice covers on `now`, in UTC: this month through today, the whole of last month,
 * the last 3 or 12 months from the 1st through today, or a custom first and last day (swapped
 * if given the wrong way round; this month's 1st or today for one that's missing). Both ends
 * are then kept between the day of the org's first entry (`start`; today if it has none) and
 * today, so a range from before the org's history or partly in the future is clamped, never an
 * error.
 */
export function resolveRange(choice: RangeChoice, now: Date, start: Date | null): ChosenRange {
  const today = startOfUtcDay(now);
  const earliest = start === null || start > now ? today : startOfUtcDay(start);
  const month = monthRange(now).from;
  const [from, to] = presetDays(choice, month, today);
  const clamp = (day: Date) =>
    new Date(Math.min(Math.max(day.getTime(), earliest.getTime()), today.getTime()));
  const first = clamp(from);
  const last = clamp(to);
  return {
    preset: choice.preset,
    range: { from: first, to: new Date(last.getTime() + DAY_MS) },
    first,
    last,
    earliest,
    today,
  };
}

function presetDays(choice: RangeChoice, month: Date, today: Date): [Date, Date] {
  switch (choice.preset) {
    case "this_month":
      return [month, today];
    case "last_month":
      return [monthsOn(month, -1), new Date(month.getTime() - DAY_MS)];
    case "3m":
      return [monthsOn(month, -2), today];
    case "12m":
      return [monthsOn(month, -11), today];
    case "custom": {
      const from = parseDay(choice.from) ?? month;
      const to = parseDay(choice.to) ?? today;
      return from <= to ? [from, to] : [to, from];
    }
  }
}

/** Whether `now` falls inside the range: the balance's projection and pauses show only then. */
export const includesNow = (range: SpendingRange, now: Date) => range.from <= now && now < range.to;

/** Whether the range lies inside one calendar month (UTC). */
export function withinOneMonth(range: SpendingRange): boolean {
  const last = new Date(range.to.getTime() - 1);
  return (
    range.from.getUTCFullYear() === last.getUTCFullYear() &&
    range.from.getUTCMonth() === last.getUTCMonth()
  );
}

export type SpendingUnit = "day" | "week" | "month";

/** How a range of `days` days is bucketed: by day up to 45, by week up to 125, then by month. */
export function bucketUnit(days: number): SpendingUnit {
  if (days <= 45) return "day";
  return days <= 125 ? "week" : "month";
}

/** A stretch of the range's days added up: one day, a week, or a calendar month. */
export type SpendingBucket = {
  /** Its first day, and that day's index in the range. */
  from: Date;
  first: number;
  /** How many of the range's days it holds. */
  days: number;
  byKind: SpendingByKind;
  spent: number;
};

/**
 * The days' spending bucketed by the range's length (`bucketUnit`): weeks run on from the
 * range's first day, months start on the 1st, so the first and last may be partial.
 */
export function spendingBuckets(days: DailySpending[]): SpendingBucket[] {
  const unit = bucketUnit(days.length);
  const buckets: SpendingBucket[] = [];
  days.forEach((day, i) => {
    const continues =
      unit === "week" ? i % 7 !== 0 : unit === "month" && day.day.getUTCDate() !== 1;
    let bucket = buckets.at(-1);
    if (!continues || bucket === undefined) {
      bucket = {
        from: day.day,
        first: i,
        days: 0,
        byKind: { workflow: 0, memory: 0, builder: 0, agent: 0, try_it: 0 },
        spent: 0,
      };
      buckets.push(bucket);
    }
    bucket.days += 1;
    bucket.spent += day.spent;
    for (const kind of SPENDING_KINDS) bucket.byKind[kind] += day.byKind[kind];
  });
  return buckets;
}

/**
 * A workflow's month-to-date spending at the end of each of the range's `days`: a running
 * total that starts again on each 1st, from what its first month spent before the range.
 */
export function monthToDate(
  days: Date[],
  line: Pick<WorkflowSpending, "daily" | "monthBefore">,
): number[] {
  let total = line.monthBefore;
  return days.map((day, i) => {
    if (day.getUTCDate() === 1) total = 0;
    total += line.daily[i] ?? 0;
    return total;
  });
}

/**
 * The days on which a month's running total (`monthToDate`) reached `budget`: where it is at
 * or over it and wasn't the day before. A month that reached it before the range isn't marked.
 */
export function budgetReachedOn(
  days: Date[],
  totals: number[],
  monthBefore: number,
  budget: number,
): Date[] {
  return days.filter((day, i) => {
    const before = day.getUTCDate() === 1 ? 0 : i === 0 ? monthBefore : (totals[i - 1] ?? 0);
    return (totals[i] ?? 0) >= budget && before < budget;
  });
}

/**
 * A workflow's line on the page from its spending over the summary's range and its budget:
 * its month's running total and the days that reached the budget. `reachedNow` is whether it's
 * paused now, budget reached (`budgetsReached`, the pause's own rule), which the page says only
 * while the range includes today; a past month only has its days.
 */
export function workflowLine(
  summary: SpendingSummary,
  spending: WorkflowSpending,
  workflow: { name: string; monthlyBudget: number | null },
  reachedNow: boolean,
  now: Date,
): WorkflowSpendingLine {
  const days = summary.days.map((day) => day.day);
  const totals = monthToDate(days, spending);
  const budget = workflow.monthlyBudget;
  return {
    ...spending,
    ...workflow,
    monthToDate: totals,
    reachedOn: budget === null ? [] : budgetReachedOn(days, totals, spending.monthBefore, budget),
    budgetReached: reachedNow && includesNow(summary.range, now),
  };
}
