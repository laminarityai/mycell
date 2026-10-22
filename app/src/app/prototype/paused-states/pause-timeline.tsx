// PROTOTYPE, throwaway: variant C's timeline for one paused switch: when each pause that holds
// began, oldest first, then what has to happen, in M7's order, before it runs again.
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { PAUSED_TEXT } from "../_shared/fixtures";
import { LIFT_EVENT } from "./pause-copy";
import { heldFor, type PauseRow, pausedLabel } from "./paused-fixtures";

type Step = { key: string; when: React.ReactNode; what: string; tone: "past" | "now" | "next" };

export function PauseTimeline({ row }: { row: PauseRow }) {
  const started = [...row.reasons]
    .filter((reason) => row.since[reason] !== undefined)
    .sort((a, b) => (row.since[a]?.getTime() ?? 0) - (row.since[b]?.getTime() ?? 0));
  const steps: Step[] = [
    ...started.map((reason): Step => {
      const since = row.since[reason];
      return {
        key: `began-${reason}`,
        when: since === undefined ? null : <DateTime value={since} />,
        what: `${pausedLabel(reason)} began`,
        tone: "past",
      };
    }),
    {
      key: "now",
      when: "Now",
      what: pausedLabel(row.reasons[0]),
      tone: "now",
    },
    ...row.reasons.map((reason, i): Step => {
      const next = row.reasons.at(i + 1);
      return {
        key: `lift-${reason}`,
        when: LIFT_EVENT[reason],
        what: next === undefined ? "Runs again" : `Still paused: ${PAUSED_TEXT[next]}`,
        tone: "next",
      };
    }),
  ];
  return (
    <ol className="flex flex-wrap gap-y-3 text-xs" aria-label={`How ${row.name} got here`}>
      {steps.map((step, i) => (
        <li key={step.key} className="flex min-w-36 flex-1 flex-col gap-1">
          <div className="flex items-center">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full border-2",
                step.tone === "past" && "border-foreground bg-foreground",
                step.tone === "now" && "border-destructive bg-destructive",
                step.tone === "next" && "border-muted-foreground bg-background",
              )}
            />
            {i === steps.length - 1 ? null : (
              <span
                className={cn(
                  "h-px flex-1",
                  step.tone === "past" ? "bg-foreground/60" : "border-t border-dashed",
                )}
              />
            )}
          </div>
          <span className={cn("pr-3", step.tone === "next" && "text-muted-foreground")}>
            {step.when}
          </span>
          <span
            className={cn(
              "pr-3",
              step.tone === "now" ? "font-medium" : "text-muted-foreground",
              step.key.startsWith("lift") && step.what === "Runs again" && "text-foreground",
            )}
          >
            {step.what}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "for 40 minutes", for the Since column. */
export const sinceText = (row: PauseRow) => {
  const since = row.since[row.reasons[0]];
  return since === undefined ? null : (
    <span className="flex flex-col">
      <DateTime value={since} />
      <span className="text-xs text-muted-foreground">for {heldFor(since)}</span>
    </span>
  );
};
