"use client";

// PROTOTYPE, throwaway: variant E2's date range, beside the page title: four presets and Custom,
// which opens a from and a to date. The chosen range is always written out in words under it.
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isoDay, MAX_DAY, MIN_DAY, RANGE_KEYS, RANGE_LABEL, rangeWords } from "./range";
import { useRange } from "./use-range";

export function RangeControl() {
  const { range, update } = useRange();
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div
        role="group"
        aria-label="Date range"
        className="inline-flex flex-wrap rounded-lg bg-muted p-[3px] text-sm"
      >
        {RANGE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={range.key === key}
            onClick={() => {
              update(
                key === "custom"
                  ? { range: key, from: isoDay(range.first), to: isoDay(range.last) }
                  : { range: key, from: null, to: null },
              );
            }}
            className={cn(
              "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground",
              range.key === key && "bg-background font-medium text-foreground shadow-xs",
            )}
          >
            {RANGE_LABEL[key]}
          </button>
        ))}
      </div>
      {range.key === "custom" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              className="h-8 w-auto"
              min={MIN_DAY}
              max={MAX_DAY}
              value={isoDay(range.first)}
              onChange={(e) => {
                if (e.target.value) update({ from: e.target.value });
              }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              className="h-8 w-auto"
              min={MIN_DAY}
              max={MAX_DAY}
              value={isoDay(range.last)}
              onChange={(e) => {
                if (e.target.value) update({ to: e.target.value });
              }}
            />
          </label>
        </div>
      ) : null}
      <p className="text-sm font-medium tabular-nums" aria-live="polite">
        {rangeWords(range)}
      </p>
    </div>
  );
}
