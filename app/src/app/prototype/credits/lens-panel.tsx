"use client";

// PROTOTYPE, throwaway: variant E's one chart and its lenses. A segmented control picks what it
// plots: the balance with its projection, each day's spending stacked by kind, or each workflow's
// running total against its budget. The breakdown underneath drives it too.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BalanceChart } from "./balance-chart";
import type { Frame } from "./chart-kit";
import { KindsChart } from "./kinds-chart";
import { LensSummary, type Focus, type Lens } from "./lens-summary";
import type { KindKey } from "./series";
import { WorkflowsChart } from "./workflows-chart";

const FRAME: Omit<Frame, "yMax"> = {
  w: 980,
  h: 360,
  pad: { left: 52, right: 20, top: 24, bottom: 28 },
};

const LENSES: { key: Lens; label: string; title: string; note: (out: boolean) => string }[] = [
  {
    key: "balance",
    label: "Balance",
    title: "Balance this month",
    note: (out) =>
      out
        ? "At the end of each day (UTC), until it reached zero this morning."
        : "Solid: at the end of each day (UTC). Dashed: this week's rate carried forward to zero.",
  },
  {
    key: "kinds",
    label: "Spending by kind",
    title: "Spent each day, by kind of use",
    note: () => "Stacked in the order of the list below. A band that thickens is a kind that grew.",
  },
  {
    key: "workflows",
    label: "Spending by workflow",
    title: "Each workflow's running total, against its budget",
    note: () => "Live runs only. Dashed: the workflow's monthly budget. A red dot: it paused.",
  },
];

export function LensPanel({ out }: { out: boolean }) {
  const [lens, setLens] = useState<Lens>("balance");
  const [focus, setFocus] = useState<Focus>(null);
  const shown = focus?.lens ?? lens;
  const meta = LENSES.find((l) => l.key === shown) ?? LENSES[0];
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Over time" className="flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold">{meta.title}</h2>
            <p className="text-xs text-muted-foreground">{meta.note(out)}</p>
          </div>
          <div
            role="group"
            aria-label="Plot"
            className="inline-flex rounded-lg bg-muted p-[3px] text-sm"
          >
            {LENSES.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={lens === l.key}
                onClick={() => {
                  setLens(l.key);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground",
                  lens === l.key && "bg-background font-medium text-foreground shadow-xs",
                  shown === l.key && lens !== l.key && "text-foreground ring-1 ring-border",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {shown === "balance" ? (
          <BalanceChart out={out} frame={FRAME} />
        ) : shown === "kinds" ? (
          <KindsChart
            out={out}
            frame={FRAME}
            highlight={focus?.lens === "kinds" ? (focus.key as KindKey) : null}
          />
        ) : (
          <WorkflowsChart
            out={out}
            frame={FRAME}
            highlight={focus?.lens === "workflows" ? focus.key : null}
          />
        )}
      </section>
      <LensSummary
        out={out}
        focus={focus}
        onFocus={setFocus}
        onPick={(l) => {
          setLens(l);
        }}
      />
      <p className="-mt-6 px-2 text-xs text-muted-foreground">
        Point at a kind or a workflow to see it in the chart; click it to keep that view.
      </p>
    </div>
  );
}
