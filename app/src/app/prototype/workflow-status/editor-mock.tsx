// PROTOTYPE, throwaway: stand-ins for the rest of a workflow's page (the graph editor and the
// switch section), so each variant's status area is judged in context. Not under test.
import { cn } from "@/lib/utils";

const STEPS = [
  ["Trigger", "New mail labelled Quotes"],
  ["classify", "Is it a quote request?"],
  ["lookup-price", "Find prices in the price sheet"],
  ["draft-reply", "Draft a reply with the quote"],
  ["Review", "A person checks the draft"],
] as const;

export function EditorPlaceholder({
  failedStep,
  className,
}: {
  /** Outlined red when the latest runs failed there. */
  failedStep?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 p-4",
        className,
      )}
      aria-label="Workflow editor (placeholder)"
    >
      <p className="text-xs text-muted-foreground">Editor and graph (placeholder)</p>
      <ol className="flex flex-col items-center gap-0">
        {STEPS.map(([id, what], i) => (
          <li key={id} className="flex flex-col items-center">
            {i > 0 ? <span className="h-4 w-px bg-border" /> : null}
            <span
              className={cn(
                "flex w-64 flex-col rounded-md border bg-background px-3 py-2 text-sm",
                failedStep === id && "border-destructive ring-1 ring-destructive/40",
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">{id}</span>
              {what}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SwitchPlaceholder() {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Who it runs for</span>
      Switched on by Priya, Sam and Dana for their own inboxes (placeholder).
    </div>
  );
}
