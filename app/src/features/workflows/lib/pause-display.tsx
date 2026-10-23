// How a switch's state shows wherever a switch is shown: a badge with its effective state (the
// first pause that holds, or on, or off), and a notice explaining every pause that holds.
import { Badge } from "@/components/ui/badge";
import type { PausedChange, PausedReason, WorkflowSwitch } from "../types";
import { pauseLift, pauseMeaning, pausedChangeText, pausedText } from "./paused-text";

/** "Paused: out of credits", for a switch's first pause. */
export function PauseBadge({
  reason,
  change,
}: {
  reason: PausedReason;
  change: PausedChange | null;
}) {
  return <Badge variant="secondary">Paused: {pausedText(reason, change)}</Badge>;
}

/**
 * Whether the workflow is on for the member: their own enablement or the org switch, on or
 * paused and why, or off.
 */
export function StateBadge({ current }: { current: WorkflowSwitch | null }) {
  if (current === null) return <Badge variant="secondary">Off</Badge>;
  const shown = current.pauses.at(0);
  if (shown !== undefined) return <PauseBadge reason={shown} change={current.pausedChange} />;
  return (
    <Badge variant="outline">
      {current.kind === "member" ? "On for your Google account" : "On for the shared inbox"}
    </Badge>
  );
}

/**
 * Why a switch is paused: for each pause that holds, in order, what it means and what lifts it,
 * and what a new version changed when one waits for the member's OK. Nothing while it runs.
 */
export function PausedNotice({ current }: { current: WorkflowSwitch | null }) {
  if (current === null || current.pauses.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Why it's paused"
      className="flex flex-col gap-2 rounded-md border-l-2 border-foreground/20 bg-muted/50 px-3 py-2.5"
    >
      {current.pauses.map((reason, index) => (
        <div key={reason} className="flex flex-col gap-1">
          {index === 0 ? null : (
            <p className="font-medium">
              It&apos;s also paused: {pausedText(reason, current.pausedChange)}.
            </p>
          )}
          <p>{pauseMeaning(reason)}</p>
          {reason === "needs_reenable" ? <Changes change={current.pausedChange} /> : null}
          <p className="text-muted-foreground">{pauseLift(reason, current.kind)}</p>
        </div>
      ))}
    </div>
  );
}

// What the versions published since the member switched it on changed.
function Changes({ change }: { change: PausedChange | null }) {
  const changes = pausedChangeText(change);
  if (changes.length === 0) return null;
  return (
    <div role="group" aria-label="What changed">
      <ul className="list-disc pl-5">
        {changes.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
