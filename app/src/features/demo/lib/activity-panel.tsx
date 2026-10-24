import { CalendarClock, Check, Globe, Loader2, Plug, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type Routine = { name: string; when: string };
export type BrowserRun = { url: string; step: number };

export const browserSteps = [
  "Searching the web",
  "Opening top results",
  "Reading sources",
  "Writing a summary",
];
export const browsePattern =
  /\b(search|look up|find|research|browse|website|news|price|compare|competitor)/i;
export const schedulePattern =
  /\b(every (day|morning|week|monday)|daily|weekly|remind me|each (day|morning|week))\b/i;

export const scheduleFor = (text: string) =>
  /week|monday/i.test(text)
    ? "Mondays at 9:00 AM"
    : /morning/i.test(text)
      ? "Every day at 8:00 AM"
      : "Every day at 9:00 AM";

/** What the agent is doing: its browser, its scheduled routines, and the apps it can use. */
export function ActivityPanel({
  browser,
  routines,
  connections,
  onClose,
}: {
  browser: BrowserRun | null;
  routines: Routine[];
  connections: string[];
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Agent activity"
      className="flex w-full shrink-0 flex-col border-l bg-muted/20 md:w-80"
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        <h3 className="text-sm font-semibold">Activity</h3>
        <Button size="icon-sm" variant="ghost" aria-label="Close activity" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="space-y-6 overflow-y-auto p-4">
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <Globe className="size-3.5" />
            Browser
          </h4>
          {browser ? (
            <div className="overflow-hidden rounded-xl border bg-background">
              <p className="truncate border-b px-3 py-2 text-[11px] text-muted-foreground">
                {browser.url}
              </p>
              <ol className="space-y-1.5 px-3 py-2.5 text-xs">
                {browserSteps.map((label, index) => (
                  <li
                    key={label}
                    className={
                      index > browser.step
                        ? "flex items-center gap-2 text-muted-foreground/50"
                        : "flex items-center gap-2"
                    }
                  >
                    {index < browser.step ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : index === browser.step ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {label}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Opens when the agent browses the web for you.
            </p>
          )}
        </section>
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <CalendarClock className="size-3.5" />
            Scheduled routines
          </h4>
          {routines.length ? (
            <ul className="space-y-2">
              {routines.map((routine) => (
                <li
                  key={routine.name + routine.when}
                  className="rounded-lg border bg-background px-3 py-2"
                >
                  <p className="text-sm font-medium">{routine.name}</p>
                  <p className="text-xs text-muted-foreground">{routine.when}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask for something “every morning” or “weekly” to schedule it.
            </p>
          )}
        </section>
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <Plug className="size-3.5" />
            Connections
          </h4>
          <p className="flex flex-wrap gap-1">
            {connections.map((connection) => (
              <Badge key={connection} variant="outline">
                {connection}
              </Badge>
            ))}
          </p>
        </section>
      </div>
    </aside>
  );
}
