// The Credits page's date range, beside its title: the presets as links and Custom's from and to
// days as a GET form, so the range lives in the address and survives a reload; the range shown
// is always written out under them.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RANGE_PRESET_LABELS } from "../format";
import { dayParam } from "../range";
import { type ChosenRange, RANGE_PRESETS, type RangePreset } from "../types";

/** The address of a preset; Custom starts from the range shown. */
function hrefOf(preset: RangePreset, chosen: ChosenRange): string {
  if (preset === "this_month") return "/credits";
  if (preset !== "custom") return `/credits?range=${preset}`;
  return `/credits?range=custom&from=${dayParam(chosen.first)}&to=${dayParam(chosen.last)}`;
}

export function RangeControl({ chosen }: { chosen: ChosenRange }) {
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <nav aria-label="Date range" className="inline-flex flex-wrap rounded-lg bg-muted p-[3px]">
        {RANGE_PRESETS.map((preset) => (
          <Button
            key={preset}
            asChild
            variant="ghost"
            size="sm"
            className={cn(
              "text-muted-foreground",
              chosen.preset === preset && "bg-background text-foreground shadow-xs",
            )}
          >
            <Link
              href={hrefOf(preset, chosen)}
              aria-current={chosen.preset === preset ? "page" : undefined}
            >
              {RANGE_PRESET_LABELS[preset]}
            </Link>
          </Button>
        ))}
      </nav>
      {chosen.preset === "custom" ? <CustomRange chosen={chosen} /> : null}
      <p className="text-sm font-medium tabular-nums">
        <RangeWords chosen={chosen} />
      </p>
    </div>
  );
}

/** Custom's first and last days, between the org's first entry and today. */
function CustomRange({ chosen }: { chosen: ChosenRange }) {
  const bounds = { min: dayParam(chosen.earliest), max: dayParam(chosen.today) };
  const first = dayParam(chosen.first);
  const last = dayParam(chosen.last);
  return (
    <form
      method="get"
      action="/credits"
      aria-label="Custom range"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="range" value="custom" />
      <label htmlFor="credits-from" className="text-muted-foreground">
        From
      </label>
      {/* Keyed by its value, so following a link resets it to the address's range. */}
      <Input
        key={`from-${first}`}
        id="credits-from"
        name="from"
        type="date"
        className="h-8 w-auto"
        defaultValue={first}
        {...bounds}
      />
      <label htmlFor="credits-to" className="text-muted-foreground">
        to
      </label>
      <Input
        key={`to-${last}`}
        id="credits-to"
        name="to"
        type="date"
        className="h-8 w-auto"
        defaultValue={last}
        {...bounds}
      />
      <Button type="submit" size="sm" variant="outline">
        Show
      </Button>
    </form>
  );
}

/** The range in words: "Oct 1, 2026 – Oct 23, 2026", or one day. */
export function RangeWords({ chosen }: { chosen: ChosenRange }) {
  if (chosen.first.getTime() === chosen.last.getTime())
    return <DateTime value={chosen.first} day />;
  return (
    <>
      <DateTime value={chosen.first} day /> – <DateTime value={chosen.last} day />
    </>
  );
}
