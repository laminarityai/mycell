// PROTOTYPE, throwaway: variant E's breakdown under the chart, B's split in two compact columns:
// kinds of use, and workflows against their budgets. Pointing at a row shows its series in the
// chart (switching lens while the pointer stays); clicking keeps that lens.
import { cn } from "@/lib/utils";
import { WORKFLOW_TONES } from "./chart-kit";
import { GROUP_COLOR, MONTH_GROUPS } from "./fixtures";
import { fmt } from "./format";
import { creditScenario, KIND_ORDER, tracksFor, type KindKey } from "./series";
import { PauseBadge } from "./workflow-rows";

export type Lens = "balance" | "kinds" | "workflows";
export type Focus = { lens: Lens; key: string } | null;

const LABEL = Object.fromEntries(MONTH_GROUPS.map((g) => [g.key, g.label]));

export function LensSummary({
  out,
  focus,
  onFocus,
  onPick,
}: {
  out: boolean;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onPick: (lens: Lens) => void;
}) {
  const s = creditScenario(out);
  const tracks = tracksFor(out);
  const total = (k: KindKey) => s.kinds[k].reduce((a, b) => a + b, 0);
  const top = Math.max(...KIND_ORDER.map(total));
  const row = (lens: Lens, key: string) => ({
    onMouseEnter: () => {
      onFocus({ lens, key });
    },
    onFocus: () => {
      onFocus({ lens, key });
    },
    onMouseLeave: () => {
      onFocus(null);
    },
    onBlur: () => {
      onFocus(null);
    },
    onClick: () => {
      onPick(lens);
    },
    className: cn(
      "grid w-full items-center gap-x-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
      focus?.key === key && "bg-muted/60",
    ),
  });
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-label="By kind of use" className="flex flex-col gap-1">
        <h2 className="flex items-baseline justify-between px-2 pb-1 font-semibold">
          By kind of use
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {fmt(s.spent)} this month
          </span>
        </h2>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            {...row("kinds", k)}
            className={cn(
              row("kinds", k).className,
              "grid-cols-[0.625rem_8rem_minmax(0,1fr)_7rem]",
            )}
          >
            <span className={cn("size-2.5 rounded-sm", GROUP_COLOR[k])} />
            <span>{LABEL[k]}</span>
            <span className="h-1.5 rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", GROUP_COLOR[k])}
                style={{ width: `${String((total(k) / top) * 100)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {fmt(total(k))}{" "}
              <span className="text-muted-foreground">
                {String(Math.round((total(k) / s.spent) * 100))}%
              </span>
            </span>
          </button>
        ))}
      </section>
      <section aria-label="Workflows against their budgets" className="flex flex-col gap-1">
        <h2 className="flex items-baseline justify-between px-2 pb-1 font-semibold">
          Workflows against their budgets
          <span className="text-sm font-normal text-muted-foreground">live runs only</span>
        </h2>
        {tracks.map((t, n) => {
          const { budget, spentThisMonth: spent } = t.workflow;
          const reached = budget !== null && spent >= budget;
          const near = budget !== null && !reached && spent / budget >= 0.7;
          return (
            <button
              key={t.workflow.id}
              type="button"
              {...row("workflows", t.workflow.id)}
              className={cn(
                row("workflows", t.workflow.id).className,
                "grid-cols-[0.625rem_minmax(0,1fr)_6rem_7rem]",
              )}
            >
              <span className={cn("size-2.5 rounded-full", WORKFLOW_TONES[n].bg)} />
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate">{t.workflow.name}</span>
                <PauseBadge reason={t.paused} />
              </span>
              {budget === null ? (
                <span className="text-xs text-muted-foreground">no budget</span>
              ) : (
                <span className="h-1.5 rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      reached ? "bg-destructive" : near ? "bg-amber-500" : "bg-foreground",
                    )}
                    style={{ width: `${String(Math.min(100, (spent / budget) * 100))}%` }}
                  />
                </span>
              )}
              <span className="text-right tabular-nums">
                {fmt(spent)}
                {budget === null ? null : (
                  <span className="text-muted-foreground"> / {fmt(budget)}</span>
                )}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
