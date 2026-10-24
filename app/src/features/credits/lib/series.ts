// The Credits page's series, worked out from a range's summary: the balance at each day's end,
// and running totals. Pure: the totals themselves were summed in the database.
import { DAY_MS, type SpendingSummary } from "../types";

/** How many of the range's days have begun by `now`: all of them for a range in the past. */
export function daysBegun(summary: SpendingSummary, now: Date): number {
  const begun = summary.days.filter((day) => day.day.getTime() <= now.getTime()).length;
  return Math.min(begun, summary.days.length);
}

/** `now`, in days from the range's start. */
export const nowDay = (summary: SpendingSummary, now: Date) =>
  (now.getTime() - summary.range.from.getTime()) / DAY_MS;

/**
 * The balance through the range as (day, balance) points: as it began, then at the end of each
 * day that has ended, then now, if the range runs on past it.
 */
export function balancePoints(summary: SpendingSummary, now: Date): [number, number][] {
  let balance = summary.openingBalance;
  const at = nowDay(summary, now);
  const pts: [number, number][] = [[0, balance]];
  summary.days.slice(0, daysBegun(summary, now)).forEach((day, i) => {
    balance += day.granted - day.spent;
    pts.push([Math.min(i + 1, at), balance]);
  });
  return pts;
}

/** A series' running total at the end of each day begun, from 0 as the range began. */
export function runningTotals(daily: number[], begun: number): number[] {
  let total = 0;
  return daily.slice(0, begun).map((spent) => (total += spent));
}
