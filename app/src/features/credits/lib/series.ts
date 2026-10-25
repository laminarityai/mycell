// The Credits page's series, worked out from a range's summary: the balance through each day,
// with grants as steps up. Pure: the totals themselves were summed in the database.
import { DAY_MS, type SpendingSummary } from "../types";

/** How many of the range's days have begun by `now`: all of them for a range in the past. */
export function daysBegun(summary: SpendingSummary, now: Date): number {
  const begun = summary.days.filter((day) => day.day.getTime() <= now.getTime()).length;
  return Math.min(begun, summary.days.length);
}

/** `at`, in days from the range's start (fractional). */
export const dayOf = (summary: SpendingSummary, at: Date) =>
  (at.getTime() - summary.range.from.getTime()) / DAY_MS;

/** `now`, in days from the range's start. */
export const nowDay = (summary: SpendingSummary, now: Date) => dayOf(summary, now);

/** One begun day's balance: as it began, what was granted, and as it ended (or now, today). */
export type DayBalance = { start: number; granted: number; spent: number; end: number };

/** The balance through each day of the range that has begun. */
export function dayBalances(summary: SpendingSummary, now: Date): DayBalance[] {
  let balance = summary.openingBalance;
  return summary.days.slice(0, daysBegun(summary, now)).map((day) => {
    const start = balance;
    balance += day.granted - day.spent;
    return { start, granted: day.granted, spent: day.spent, end: balance };
  });
}

/**
 * The balance through the range as (day, balance) points: as it began, then each day's grant
 * as a step up at its start, and the balance at its end (or now, if the range runs on past it).
 */
export function balancePoints(summary: SpendingSummary, now: Date): [number, number][] {
  const at = nowDay(summary, now);
  const pts: [number, number][] = [[0, summary.openingBalance]];
  dayBalances(summary, now).forEach((day, i) => {
    if (day.granted > 0) pts.push([i, day.start + day.granted]);
    pts.push([Math.min(i + 1, at), day.end]);
  });
  return pts;
}
