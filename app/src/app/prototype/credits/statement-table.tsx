"use client";

// PROTOTYPE, throwaway: variant A's statement, the ledger as a bank would print it: every entry
// with what it was, its credits and the balance after it, filterable by kind.
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import type { StatementRow } from "./fixtures";
import { describe, fmt, signed } from "./format";

const FILTERS = [
  { key: "all", label: "All entries" },
  { key: "grant", label: "Grants" },
  { key: "usage", label: "Usage" },
  { key: "correction", label: "Corrections" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

export function StatementTable({ rows, hidden }: { rows: StatementRow[]; hidden: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows.filter((row) => filter === "all" || row.kind === filter);
  const firstGrant = shown.findIndex((row) => row.kind === "grant");
  return (
    <section aria-label="Statement" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Statement</h2>
        <div role="group" aria-label="Show" className="flex gap-1 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
              }}
              className={cn(
                "rounded-md px-2 py-1 text-muted-foreground hover:text-foreground",
                filter === f.key && "bg-muted font-medium text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] text-sm">
        <div className="contents text-xs text-muted-foreground">
          <span className="border-b pb-2">Entry</span>
          <span className="border-b pb-2 pl-6 text-right">Credits</span>
          <span className="border-b pb-2 pl-6 text-right">Balance after</span>
        </div>
        {shown.map((row, i) => {
          const { title, detail } = describe(row);
          return (
            <div key={row.id} className="contents">
              {i === firstGrant && filter !== "grant" ? <Gap hidden={hidden} /> : null}
              <div
                className={cn(
                  "flex flex-col gap-0.5 border-b py-3",
                  row.kind === "grant" && "pl-3",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn(row.kind !== "usage" && "font-medium")}>{title}</span>
                  {row.kind === "correction" ? (
                    <span className="text-xs text-destructive">failed call</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  <DateTime value={row.at} />
                  {detail ? <> &ndash; {detail}</> : null}
                </span>
              </div>
              <span
                className={cn(
                  "border-b py-3 pl-6 text-right tabular-nums",
                  row.kind === "grant" && "font-semibold text-emerald-700 dark:text-emerald-400",
                )}
              >
                {signed(row.credits)}
              </span>
              <span className="border-b py-3 pl-6 text-right text-muted-foreground tabular-nums">
                {row.balanceAfter === null ? "" : fmt(row.balanceAfter)}
              </span>
            </div>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries of this kind yet.</p>
      ) : null}
    </section>
  );
}

function Gap({ hidden }: { hidden: number }) {
  return (
    <div className="col-span-3 border-b py-2 text-center text-xs text-muted-foreground">
      {fmt(hidden)} earlier entries this month,{" "}
      <button type="button" className="underline">
        show them
      </button>
    </div>
  );
}
