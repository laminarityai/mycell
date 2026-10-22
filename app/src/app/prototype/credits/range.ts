// PROTOTYPE, throwaway: variant E2's date range: the presets, how `?range=&from=&to=` reads back
// into days, and the range in words. Ranges are whole UTC days, both ends included, and never
// reach before the history starts or past today.
import { HISTORY_DAYS, HISTORY_START, MONTH_STARTS } from "./history";
import { DAY_MS, MONTH_START } from "./series";

export const RANGE_KEYS = ["this_month", "last_month", "3m", "12m", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL: Record<RangeKey, string> = {
  this_month: "This month",
  last_month: "Last month",
  "3m": "Last 3 months",
  "12m": "Last 12 months",
  custom: "Custom",
};

export type DayRange = {
  key: RangeKey;
  /** First and last day, as indexes into HISTORY_DAYS. */
  first: number;
  last: number;
};

const TODAY = HISTORY_DAYS.length - 1;
const indexOf = (d: Date) => Math.round((d.getTime() - HISTORY_START.getTime()) / DAY_MS);
const monthsBack = (n: number) => MONTH_STARTS[MONTH_STARTS.length - 1 - n];

/** "2026-10-01" → its index, or null if it isn't a day. */
function parseDay(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(d.getTime()) ? null : Math.min(TODAY, Math.max(0, indexOf(d)));
}

export function readRange(get: (name: string) => string | null): DayRange {
  const key = RANGE_KEYS.find((k) => k === get("range")) ?? "this_month";
  switch (key) {
    case "last_month":
      return { key, first: indexOf(monthsBack(1)), last: indexOf(MONTH_START) - 1 };
    case "3m":
      return { key, first: indexOf(monthsBack(2)), last: TODAY };
    case "12m":
      return { key, first: indexOf(monthsBack(11)), last: TODAY };
    case "custom": {
      const a = parseDay(get("from")) ?? indexOf(MONTH_START);
      const b = parseDay(get("to")) ?? TODAY;
      return { key, first: Math.min(a, b), last: Math.max(a, b) };
    }
    default:
      return { key, first: indexOf(MONTH_START), last: TODAY };
  }
}

/** A day as a date input wants it: "2026-10-01". */
export const isoDay = (i: number) => HISTORY_DAYS[i].toISOString().slice(0, 10);
export const MIN_DAY = isoDay(0);
export const MAX_DAY = isoDay(TODAY);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 8" or "Oct 8, 2025". SVG text and range words can't hold a <time>. */
export function dayLabel(d: Date, year = false) {
  const base = `${MON[d.getUTCMonth()]} ${String(d.getUTCDate())}`;
  return year ? `${base}, ${String(d.getUTCFullYear())}` : base;
}

/** "Jan" or, for January and the first month shown, "Jan 2026". */
export function monthLabel(d: Date, withYear: boolean) {
  return withYear ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear())}` : MON[d.getUTCMonth()];
}

/** "Oct 1 – Oct 22, 2026", or "Nov 1, 2025 – Oct 22, 2026" across a year. */
export function rangeWords(r: DayRange) {
  const a = HISTORY_DAYS[r.first];
  const b = HISTORY_DAYS[r.last];
  if (r.first === r.last) return dayLabel(a, true);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${dayLabel(a, !sameYear)} – ${dayLabel(b, true)}`;
}

export const includesToday = (r: DayRange) => r.last === TODAY;
export const TODAY_INDEX = TODAY;

/** Whether the range sits inside one calendar month. */
export const oneMonth = (r: DayRange) =>
  HISTORY_DAYS[r.first].getUTCMonth() === HISTORY_DAYS[r.last].getUTCMonth() &&
  HISTORY_DAYS[r.first].getUTCFullYear() === HISTORY_DAYS[r.last].getUTCFullYear();

export const rangeLength = (r: DayRange) => r.last - r.first + 1;
