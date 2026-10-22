// PROTOTYPE, throwaway: what variant E2 works out from a range: where its time axis ends, how
// spending is bucketed (days, weeks or months by span), totals in the range, and each
// workflow's running total for its month (budgets are monthly, so that's what they're against).
import { HISTORY_DAYS, MONTH_STARTS, WORKFLOW_HISTORY } from "./history";
import { dayLabel, includesToday, monthLabel, type DayRange } from "./range";
import { indexAt } from "./range-kit";
import { OK_SCENARIO } from "./series";

/** The axis runs to the day after the range, or, when the range ends today, on to where the
 * balance reaches zero at this week's rate. */
export function domainEnd(r: DayRange, out: boolean) {
  if (!includesToday(r) || out) return r.last + 1;
  return Math.max(r.last + 1, Math.ceil(indexAt(OK_SCENARIO.zeroAt)));
}

export type Bucket = { first: number; last: number; label: string };

/** Days for up to 45 days, weeks for up to 4 months, else calendar months. */
export function bucketsFor(r: DayRange): Bucket[] {
  const days = r.last - r.first + 1;
  if (days <= 45) {
    return Array.from({ length: days }, (_, k) => {
      const i = r.first + k;
      return { first: i, last: i, label: dayLabel(HISTORY_DAYS[i], true) };
    });
  }
  if (days <= 125) {
    return Array.from({ length: Math.ceil(days / 7) }, (_, k) => {
      const first = r.first + k * 7;
      const last = Math.min(r.last, first + 6);
      return {
        first,
        last,
        label: `${dayLabel(HISTORY_DAYS[first])} – ${dayLabel(HISTORY_DAYS[last], true)}`,
      };
    });
  }
  return MONTH_STARTS.map((start, m) => {
    const next = MONTH_STARTS[m + 1] as Date | undefined;
    const first = Math.max(r.first, indexAt(start));
    const last = Math.min(r.last, next ? indexAt(next) - 1 : HISTORY_DAYS.length - 1);
    const whole = first === indexAt(start) && (next ? last === indexAt(next) - 1 : false);
    return {
      first,
      last,
      label: whole
        ? monthLabel(start, true)
        : `${dayLabel(HISTORY_DAYS[first])} – ${dayLabel(HISTORY_DAYS[last], true)}`,
    };
  }).filter((b) => b.first <= b.last);
}

export const sumIn = (series: number[], first: number, last: number) =>
  series.slice(first, last + 1).reduce((a, b) => a + b, 0);

/** Each workflow's spending from the 1st of the month through each day. */
export const MONTH_TO_DATE: Record<string, number[]> = Object.fromEntries(
  Object.entries(WORKFLOW_HISTORY).map(([id, series]) => {
    let sum = 0;
    return [
      id,
      series.map((v, i) => {
        if (HISTORY_DAYS[i].getUTCDate() === 1) sum = 0;
        return (sum += v);
      }),
    ];
  }),
);

/** The month (as its start) that day `i` falls in. */
export const monthStartOf = (i: number) => {
  const d = HISTORY_DAYS[i];
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
