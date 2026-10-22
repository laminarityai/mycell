// PROTOTYPE, throwaway: how the Credits page words numbers and ledger entries, the same in every
// variant so the variants differ only in layout.
import { NOW, workflowById, type LedgerEntry } from "../_shared/fixtures";

const NUMBER = new Intl.NumberFormat("en-US");

/** 3420 → "3,420". */
export const fmt = (n: number) => NUMBER.format(n);

/** -14 → "−14", 10000 → "+10,000". */
export const signed = (n: number) => (n < 0 ? `−${fmt(-n)}` : `+${fmt(n)}`);

/** "4 minutes ago", "3 hours ago", "21 days ago". */
export function ago(at: Date) {
  const minutes = Math.round((NOW.getTime() - at.getTime()) / 60_000);
  if (minutes < 60) return `${String(minutes)} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} ${days === 1 ? "day" : "days"} ago`;
}

const PURPOSE: Record<NonNullable<LedgerEntry["purpose"]>, string> = {
  run: "Run",
  try_it: "Try it",
  builder: "Builder chat",
  memory: "Memory",
  agent: "Ask Mycel",
  injection_screen: "Mail screening",
};

/** An entry's headline and the small print under it. */
export function describe(entry: LedgerEntry): { title: string; detail: string } {
  if (entry.kind === "grant") {
    return { title: entry.note ?? "Credits granted", detail: "Granted by the Mycel team" };
  }
  const workflow = entry.workflowId ? workflowById(entry.workflowId)?.name : undefined;
  const purpose = entry.purpose ? PURPOSE[entry.purpose] : "Usage";
  const what = workflow
    ? entry.purpose === "run"
      ? workflow
      : `${purpose}: ${workflow}`
    : purpose;
  const how = [entry.role ? `${entry.role} role` : null, entry.model].filter(Boolean).join(", ");
  if (entry.kind === "correction") {
    return {
      title: `Correction: ${what}`,
      detail: `A failed call the gateway still billed (${how}). Recorded at no cost first, corrected here.`,
    };
  }
  return { title: what, detail: how };
}

/** A workflow's spending against its budget, in words. */
export function budgetLine(spent: number, budget: number | null) {
  return budget === null ? `${fmt(spent)}, no budget` : `${fmt(spent)} of ${fmt(budget)}`;
}
