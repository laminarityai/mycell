// The workflow page's failures check (M8): whether its runs' failures pause it, and while they
// do, the three runs in a row that paused it and Resume. M7's Health tab lists it with its
// other checks; until then the page shows it in its own Health section.
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FailurePause, PausingRun, WorkflowDetails } from "../types";
import { ResumeForm } from "./resume-form";

/** The workflow page's Health section, for a published workflow: its failures check. */
export function WorkflowHealthSection({
  workflow,
  runs,
}: {
  workflow: Pick<WorkflowDetails, "id" | "failurePause">;
  runs: PausingRun[];
}) {
  return (
    <section className="flex flex-col gap-2" aria-label="Health">
      <h2 className="text-lg font-semibold">Health</h2>
      <FailuresCheck workflowId={workflow.id} pause={workflow.failurePause} runs={runs} />
    </section>
  );
}

export function FailuresCheck({
  workflowId,
  pause,
  runs,
}: {
  workflowId: string;
  pause: FailurePause | null;
  /** The runs that paused it (runtime's `pausingRuns`), newest first. */
  runs: PausingRun[];
}) {
  if (pause === null) {
    return (
      <div role="group" aria-label="Failures" className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Its runs aren&apos;t failing.</p>
        <p className="text-muted-foreground">
          Three failed runs in a row would pause it for everyone until you resume it. Failures from
          one person&apos;s connection or from running out of credits don&apos;t count.
        </p>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Failures" className="flex flex-col gap-3 text-sm">
      <p className="font-medium">
        Paused: failing, since <DateTime value={pause.pausedAt} />.
      </p>
      <p className="text-muted-foreground">
        Its last three runs failed, so new messages start no runs, for everyone who has it on and
        the org switch alike. Their switches stay on. Fix what failed, then resume it; messages that
        arrive until then aren&apos;t run later.
      </p>
      <Table aria-label="Runs that paused it">
        <TableHeader>
          <TableRow>
            <TableHead>Ended</TableHead>
            <TableHead>Inbox</TableHead>
            <TableHead>Failed step</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.runId}>
              <TableCell>
                {run.finishedAt === null ? "—" : <DateTime value={run.finishedAt} />}
              </TableCell>
              <TableCell>{run.inbox}</TableCell>
              <TableCell>
                {run.failedStep === null ? (
                  "—"
                ) : (
                  <code className="font-mono">{run.failedStep}</code>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">{run.error}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ResumeForm workflowId={workflowId} />
    </div>
  );
}
