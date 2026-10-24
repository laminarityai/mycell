// The credit ledger's public types.
import { z } from "zod";
import type { ModelRole } from "@/features/spec/types";

/**
 * What a usage was spent on, when no run or Try it made it: `memory`, learning from the
 * company's apps, which memory's monthly budget caps (ADR-0022); `memory_summary`, a person's
 * own summary of what memory knows, outside that budget; or `builder`, the builder chat's turns
 * and what they ask for. A run's usage names its workflow and run instead, and Try it's is
 * marked `dryRun`.
 */
export const CREDIT_PURPOSES = ["memory", "memory_summary", "builder"] as const;
export type CreditPurpose = (typeof CREDIT_PURPOSES)[number];

/** The kinds of use the Credits page splits spending into. */
export const SPENDING_KINDS = ["workflow", "memory", "builder", "try_it"] as const;
export type SpendingKind = (typeof SPENDING_KINDS)[number];

/** One model call's usage, as the gateway client (or the injection screen) records it. */
export type Usage = {
  /** The role the call named; null for a fixed service that names none (the injection screen). */
  role: ModelRole | null;
  modelId: string;
  /**
   * The gateway's reported cost in US dollars, or the injection screen's estimate at its list
   * price; 0 when the call failed without one.
   */
  costUsd: number;
  outcome: "succeeded" | "failed";
  generationId?: string;
  workflowId?: string;
  runId?: string;
  /** Made by a dry run ("Try it"), which has no run record. */
  dryRun?: boolean;
  purpose?: CreditPurpose;
};

/** A row of the ledger: a grant or a usage. `amount` is in credits. */
export type LedgerEntry = {
  id: string;
  kind: "grant" | "usage";
  amount: number;
  role: ModelRole | null;
  modelId: string | null;
  outcome: "succeeded" | "failed" | null;
  costUsd: number | null;
  generationId: string | null;
  workflowId: string | null;
  runId: string | null;
  dryRun: boolean;
  purpose: CreditPurpose | null;
  /** A grant's note from our team ("October allowance"); null for usage. */
  note: string | null;
  /**
   * A failed call's correction: the usage entry whose billed cost it records, with the same
   * attribution and time. Null for every other entry.
   */
  correctsId: string | null;
  createdAt: Date;
};

/** A failed call whose billed cost is still to be looked up: recorded at 0, under a generation. */
export type UncostedFailedCall = { id: string; generationId: string; createdAt: Date };

/** Which spending `getSpending` adds up: one purpose's usage from a time on. */
export type SpendingQuery = { purpose: CreditPurpose; since: Date };

/** A stretch of time the Credits page adds up: from `from`, up to but not including `to`. */
export type SpendingRange = { from: Date; to: Date };

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar month (UTC) `now` falls in: what "this month" counts, as budgets do. */
export function monthRange(now: Date): SpendingRange {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Each UTC day that starts in `range`, by its start. */
export function daysOf(range: SpendingRange): Date[] {
  const start = Date.UTC(
    range.from.getUTCFullYear(),
    range.from.getUTCMonth(),
    range.from.getUTCDate(),
  );
  const days: Date[] = [];
  for (let at = start; at < range.to.getTime(); at += DAY_MS) days.push(new Date(at));
  return days;
}

/** Credits spent by each kind of use. */
export type SpendingByKind = Record<SpendingKind, number>;

/** One UTC day of a range: what was spent, by kind, and granted. */
export type DailySpending = {
  /** The day's start (UTC). */
  day: Date;
  byKind: SpendingByKind;
  /** All usage that day: the kinds' sum. */
  spent: number;
  granted: number;
};

/** One workflow's live-run spending over a range, and on each of its days. */
export type WorkflowSpending = {
  workflowId: string;
  spent: number;
  /** By day, in the order of the summary's `days`. */
  daily: number[];
  /**
   * What its live runs spent in the range's first month before the range began: where that
   * month's running total starts, since budgets are monthly. 0 for a range from the 1st.
   */
  monthBefore: number;
};

/**
 * What the Credits page shows of a range: spending by kind of use, by workflow (live runs only)
 * and by day, and what was granted. Credits are positive here: 12 spent, not -12.
 */
export type SpendingSummary = {
  range: SpendingRange;
  /** The balance as the range began. */
  openingBalance: number;
  spent: number;
  granted: number;
  byKind: SpendingByKind;
  /**
   * Most spent first. Try it and builder turns about a workflow aren't its spending. One that
   * spent only before the range, in its first month, is here at 0, for its month's total.
   */
  byWorkflow: WorkflowSpending[];
  /** Every UTC day of the range, the days still to come included. */
  days: DailySpending[];
};

/**
 * How long the balance lasts at the last 7 days' average daily usage. With no usage in those
 * days there's no rate and no runway: `dailyRate`, `days` and `zeroAt` are null.
 */
export type Runway = {
  balance: number;
  dailyRate: number | null;
  /** Days left at that rate (fractional); 0 once the balance is gone. */
  days: number | null;
  /** When the balance reaches zero at that rate. */
  zeroAt: Date | null;
};

/**
 * A workflow's line on the Credits page: its spending, with its name and published budget,
 * which the page joins in from workflows (credits can't import workflows: workflows reads
 * credits for its pauses).
 */
export type WorkflowSpendingLine = WorkflowSpending & {
  name: string;
  /** Its monthly budget; null for none. */
  monthlyBudget: number | null;
  /** Its month's spending through each day of the range, starting again on each 1st. */
  monthToDate: number[];
  /** Each day of the range on which its month's spending reached its budget. */
  reachedOn: Date[];
  /**
   * This month's live runs have spent its budget: it's paused, budget reached. Shown only while
   * the range includes today.
   */
  budgetReached: boolean;
};

/**
 * The Credits page's ranges: four presets and Custom (a first and a last day). The presets
 * longer than a month start on the 1st, since budgets and grants are monthly.
 */
export const RANGE_PRESETS = ["this_month", "last_month", "3m", "12m", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** The range the address asks for: a preset, or Custom's first and last days ("2026-10-01"). */
export type RangeChoice = {
  preset: RangePreset;
  from?: string | undefined;
  to?: string | undefined;
};

/**
 * A range the page shows, in whole UTC days: `range` runs from `first`'s start to the end of
 * `last`. It stays inside the org's history, from the day of its first entry (`earliest`) to
 * `today`, the bounds a custom pick chooses between.
 */
export type ChosenRange = {
  preset: RangePreset;
  range: SpendingRange;
  first: Date;
  last: Date;
  earliest: Date;
  today: Date;
};

// A query parameter's one value: the first of several, and none for an empty one.
const queryValue = (value: unknown) => {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() !== "" ? first.trim() : undefined;
};
const queryDay = z
  .preprocess(
    queryValue,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  )
  .catch(undefined);

/**
 * The Credits page's address query: `range`, a preset (this month by default), and Custom's
 * `from` and `to` days. A value that isn't one is left out, so a stale or edited address shows
 * a range rather than failing.
 */
export const creditsQuerySchema = z
  .object({
    range: z.preprocess(queryValue, z.enum(RANGE_PRESETS).optional()).catch(undefined),
    from: queryDay,
    to: queryDay,
  })
  .transform(({ range = "this_month", from, to }): RangeChoice =>
    range === "custom" ? { preset: range, from, to } : { preset: range },
  );

/** What the Credits page's chart plots: the balance, spending by kind, or by workflow. */
export type ChartLens = "balance" | "kinds" | "workflows";

/** A ledger entry on the Credits page, with its workflow's name joined in. */
export type LedgerLine = LedgerEntry & { workflowName: string | null };

/** Which ledger entries `listLedger` returns, newest first. */
export type LedgerFilter = {
  /** At most this many (100 by default). */
  limit?: number;
  kind?: LedgerEntry["kind"];
  workflowId?: string;
  /** Only entries made in this range. */
  range?: SpendingRange;
};

// The kind of use each purpose is: a person's summaries are memory's on the Credits page,
// though memory's budget adds up only learning.
const KIND_OF_PURPOSE: Record<CreditPurpose, SpendingKind> = {
  memory: "memory",
  memory_summary: "memory",
  builder: "builder",
};

/**
 * Which kind of use a usage entry was, from its attribution: Try it (`dryRun`), a purpose's
 * kind, or a workflow's run. Null for a grant, or usage nothing attributed (a bug: every call
 * says).
 */
export function spendingKindOf(
  entry: Pick<LedgerEntry, "dryRun" | "purpose" | "runId">,
): SpendingKind | null {
  if (entry.dryRun) return "try_it";
  if (entry.purpose !== null) return KIND_OF_PURPOSE[entry.purpose];
  return entry.runId === null ? null : "workflow";
}
