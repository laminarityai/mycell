// PROTOTYPE, throwaway: variant D's key to the daily chart, which is also B's split of the month:
// each kind of use with its month total, its share, and whether it's growing (this week's daily
// rate against the rest of the month's).
import { cn } from "@/lib/utils";
import { GROUP_COLOR, MONTH_GROUPS } from "./fixtures";
import { fmt } from "./format";
import { creditScenario, KIND_ORDER } from "./series";

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function KindLegend({ out }: { out: boolean }) {
  const s = creditScenario(out);
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
      {KIND_ORDER.map((k) => {
        const group = MONTH_GROUPS.find((g) => g.key === k);
        const series = s.kinds[k];
        const month = series.reduce((a, b) => a + b, 0);
        const week = avg(series.slice(-7));
        const before = avg(series.slice(0, -7));
        const change = before === 0 ? 0 : week / before - 1;
        return (
          <li key={k} className="flex gap-2">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-sm", GROUP_COLOR[k])} />
            <span className="flex flex-col">
              <span>
                <span className="font-medium">{group?.label}</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  {fmt(month)} ({String(Math.round((month / s.spent) * 100))}%)
                </span>
              </span>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  change >= 0.25 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {fmt(Math.round(week))} a day this week,{" "}
                {Math.abs(change) < 0.1
                  ? "about as before"
                  : `${change > 0 ? "up" : "down"} ${String(Math.round(Math.abs(change) * 100))}%`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
