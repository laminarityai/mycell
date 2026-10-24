// How Mycel words credits, the same on the Credits page and in the sidebar's foot: pure, so
// client code may import it.
import type { RangePreset, SpendingKind } from "./types";

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TENTHS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** 3420.4 → "3,420"; a small amount keeps a tenth: 2.46 → "2.5". */
export function formatCredits(credits: number): string {
  const text = Math.abs(credits) < 10 ? TENTHS.format(credits) : WHOLE.format(credits);
  return text === "-0" ? "0" : text;
}

/** A ledger amount with its sign: "+10,000" granted, "−14" used, "0" for a free call. */
export function formatSigned(credits: number): string {
  const text = formatCredits(Math.abs(credits));
  if (text === "0") return text;
  return credits < 0 ? `−${text}` : `+${text}`;
}

/** Each kind of use, as the Credits page names it. */
export const SPENDING_KIND_LABELS: Record<SpendingKind, string> = {
  workflow: "Workflows",
  memory: "Memory",
  builder: "Builder chat",
  agent: "Ask Mycel",
  try_it: "Try it",
};

/** Each range preset, as the range control names it. */
export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  "3m": "Last 3 months",
  "12m": "Last 12 months",
  custom: "Custom",
};

/** What was spent or granted over a preset's range: "Spent this month", "Granted in this range". */
export const RANGE_PRESET_PHRASES: Record<RangePreset, string> = {
  this_month: "this month",
  last_month: "last month",
  "3m": "in the last 3 months",
  "12m": "in the last 12 months",
  custom: "in this range",
};
