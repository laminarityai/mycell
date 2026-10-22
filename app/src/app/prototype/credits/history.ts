// PROTOTYPE, throwaway: series.ts carried back to Oct 2025, when Fernhill started on Mycel, for
// variant E2's date ranges. Each past month has its allowance and its spending by kind and by
// workflow, spread over its days (quiet weekends; workflows only from the day they were made).
// The story: a busy spring (quote replies reached their budget on Mar 24, which was raised to
// 2,000 in May); Book customer calls arrived Aug 10; in September a memory backfill used up the
// balance on the 28th, so nothing carried into October and its allowance went up to 10,000.
// October itself is series.ts, so today's numbers are unchanged.
import { InvariantError } from "@/lib/errors";
import { CREDITS, WORKFLOWS } from "../_shared/fixtures";
import { creditScenario, DAY_MS, DAYS, KIND_ORDER, WORKFLOW_DAILY, type KindKey } from "./series";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export const HISTORY_START = utc(2025, 9, 1);
export const HISTORY_DAYS = Array.from(
  { length: Math.round((DAYS[DAYS.length - 1].getTime() - HISTORY_START.getTime()) / DAY_MS) + 1 },
  (_, i) => new Date(HISTORY_START.getTime() + i * DAY_MS),
);
/** Where October 2026 (series.ts) starts in HISTORY_DAYS. */
const OCT = HISTORY_DAYS.length - DAYS.length;

/** The first of each month, Oct 2025 to Oct 2026. */
export const MONTH_STARTS = Array.from({ length: 13 }, (_, m) => utc(2025, 9 + m, 1));
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July"].concat([
  "August",
  "September",
  "October",
  "November",
  "December",
]);

/** Each month's allowance, granted on the 1st. */
export const GRANTS = [
  2000, 2000, 2000, 2500, 3000, 4000, 5000, 5000, 5000, 5000, 6000, 8000, 10000,
];
export const grantNote = (m: number) => `${MONTH_NAMES[MONTH_STARTS[m].getUTCMonth()]} allowance`;

/** Oct 2025 … Sep 2026 by kind of use (workflows is the sum of the workflows below). */
const PAST_KINDS: Record<Exclude<KindKey, "workflows">, number[]> = {
  memory: [473, 982, 831, 1022, 1091, 1835, 2120, 2345, 2195, 2087, 2794, 4857],
  builder: [603, 390, 273, 306, 428, 342, 469, 291, 272, 259, 569, 603],
  agent: [27, 31, 25, 77, 89, 122, 147, 146, 136, 130, 190, 301],
  try_it: [229, 148, 104, 116, 163, 130, 178, 111, 103, 98, 216, 229],
  injection_screen: [8, 9, 7, 9, 11, 15, 18, 17, 16, 16, 23, 36],
};

/** Oct 2025 … Sep 2026 by workflow. The weekly status runs on Fridays, 32 each. */
const PAST_WORKFLOWS: Record<string, number[]> = {
  "wf-quotes": [300, 420, 300, 450, 700, 1508, 1350, 1480, 1200, 980, 1250, 1700],
  "wf-invoices": [0, 0, 180, 260, 280, 330, 340, 350, 330, 320, 360, 400],
  "wf-calls": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 520, 806],
  "wf-status": [0, 0, 0, 0, 128, 128, 128, 160, 128, 160, 128, 128],
  "wf-followups": [0, 0, 0, 0, 0, 0, 120, 260, 250, 230, 270, 300],
};

/** The day each workflow was made. */
export const CREATED: Record<string, Date> = {
  "wf-quotes": utc(2025, 9, 6),
  "wf-invoices": utc(2025, 11, 1),
  "wf-status": utc(2026, 1, 6),
  "wf-followups": utc(2026, 3, 13),
  "wf-calls": utc(2026, 7, 10),
};

/** A workflow's monthly budget in the month starting `month`. */
export function budgetIn(id: string, month: Date): number | null {
  if (id === "wf-quotes") return month < utc(2026, 4, 1) ? 1500 : 2000;
  return WORKFLOWS.find((w) => w.id === id)?.budget ?? null;
}

/** In September the balance hit zero on the 28th: nothing ran after it until October. */
export const SEPTEMBER_OUT = { from: utc(2026, 8, 28), lastDay: utc(2026, 8, 28) };
/** The days a budget stopped a workflow in a past month. */
const LAST_DAY: Record<string, Date[]> = {
  "wf-quotes": [utc(2026, 2, 24)],
  "wf-calls": [utc(2026, 8, 25)],
};

const monthOf = (d: Date) => (d.getUTCFullYear() - 2025) * 12 + d.getUTCMonth() - 9;
const weekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const WEEKEND: Record<string, number> = { memory: 0.7, agent: 0.4, injection_screen: 0.6 };

function spread(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (sum === 0 ? 0 : (w / sum) * total));
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]);
  const rest = total - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < rest; k++) out[order[k][1]] += 1;
  return out;
}

/** One series across the whole history: past months spread by weight, then October as is. */
function history(key: string, monthly: number[], october: number[], from = HISTORY_START) {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    const days = HISTORY_DAYS.filter((d) => monthOf(d) === m);
    if (key === "wf-status") {
      out.push(
        ...days.map((d) =>
          d >= from && d.getUTCDay() === 5 && d <= SEPTEMBER_OUT.lastDay ? 32 : 0,
        ),
      );
      continue;
    }
    const stop =
      (key in LAST_DAY ? LAST_DAY[key].find((d) => monthOf(d) === m) : undefined) ??
      SEPTEMBER_OUT.lastDay;
    const weights = days.map((d, i) => {
      if (d < from || d > stop) return 0;
      return (weekend(d) ? (WEEKEND[key] ?? 0.25) : 1) * (1 + 0.15 * Math.sin((m * 31 + i) * 2.1));
    });
    out.push(...spread(monthly[m], weights));
  }
  return [...out, ...october];
}

export const WORKFLOW_HISTORY: Record<string, number[]> = Object.fromEntries(
  Object.entries(PAST_WORKFLOWS).map(([id, monthly]) => [
    id,
    history(id, monthly, WORKFLOW_DAILY[id], CREATED[id]),
  ]),
);

function kindHistory(out: boolean): Record<KindKey, number[]> {
  const october = creditScenario(out).kinds;
  const other = Object.fromEntries(
    Object.entries(PAST_KINDS).map(([k, monthly]) => [
      k,
      history(k, monthly, october[k as KindKey]),
    ]),
  ) as Record<Exclude<KindKey, "workflows">, number[]>;
  const workflows = HISTORY_DAYS.map((_, i) =>
    Object.values(WORKFLOW_HISTORY).reduce((s, v) => s + v[i], 0),
  );
  return { workflows, ...other };
}

export type History = {
  out: boolean;
  kinds: Record<KindKey, number[]>;
  daily: number[];
  /** The balance at the end of each day (today's is now). */
  endOfDay: number[];
  /** The balance at the start of each day, before any grant that day. */
  startOfDay: number[];
  granted: number[];
};

export function historyFor(out: boolean): History {
  const kinds = kindHistory(out);
  const daily = HISTORY_DAYS.map((_, i) => KIND_ORDER.reduce((s, k) => s + kinds[k][i], 0));
  const granted = HISTORY_DAYS.map((d) => {
    const m = MONTH_STARTS.findIndex((s) => s.getTime() === d.getTime());
    return m === -1 ? 0 : GRANTS[m];
  });
  let left = 0;
  const startOfDay: number[] = [];
  const endOfDay = daily.map((v, i) => {
    startOfDay.push(left);
    left += granted[i] - v;
    return left;
  });
  return { out, kinds, daily, endOfDay, startOfDay, granted };
}

export const HISTORY_OK = historyFor(false);
export const HISTORY_OUT = historyFor(true);

/** When a workflow reached its budget in each month it did, and when it resumed. */
export function budgetHits(id: string) {
  const series = WORKFLOW_HISTORY[id];
  return MONTH_STARTS.flatMap((start, m) => {
    const budget = budgetIn(id, start);
    if (budget === null) return [];
    let sum = 0;
    for (let i = 0; i < HISTORY_DAYS.length; i++) {
      if (monthOf(HISTORY_DAYS[i]) !== m) continue;
      sum += series[i];
      if (sum >= budget) {
        return [{ at: HISTORY_DAYS[i], resumes: MONTH_STARTS[m + 1] ?? utc(2026, 10, 1), budget }];
      }
    }
    return [];
  });
}

// Each month adds up, the balance never goes below zero, September ends at exactly zero, and
// the history ends on today's numbers.
const monthSum = (series: number[], m: number) =>
  series.reduce((s, v, i) => (monthOf(HISTORY_DAYS[i]) === m ? s + v : s), 0);
const checks = {
  months: Array.from({ length: 12 }, (_, m) => m).every(
    (m) =>
      Object.entries(PAST_KINDS).every(
        ([k, v]) => monthSum(HISTORY_OK.kinds[k as KindKey], m) === v[m],
      ) &&
      Object.entries(PAST_WORKFLOWS).every(([id, v]) => monthSum(WORKFLOW_HISTORY[id], m) === v[m]),
  ),
  neverNegative: HISTORY_OK.endOfDay.every((b) => b >= 0),
  nothingCarriedIntoOctober: HISTORY_OK.startOfDay[OCT] === 0,
  endsAtToday: HISTORY_OK.endOfDay[HISTORY_DAYS.length - 1] === CREDITS.balance,
  outEndsAtZero: HISTORY_OUT.endOfDay[HISTORY_DAYS.length - 1] === 0,
  quotesHit: budgetHits("wf-quotes")[0]?.at.getTime() === LAST_DAY["wf-quotes"][0].getTime(),
  callsHit: budgetHits("wf-calls")[0]?.at.getTime() === LAST_DAY["wf-calls"][0].getTime(),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok);
if (failed.length > 0) {
  throw new InvariantError(
    `The credits history doesn't add up: ${failed.map(([k]) => k).join(", ")}.`,
  );
}
