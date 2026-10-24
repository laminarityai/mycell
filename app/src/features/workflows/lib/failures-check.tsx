// The workflow page's failures check (M8), one of its Health tab's checks: whether its runs'
// failures pause it, and while they do, the three runs in a row that paused it and Resume.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FailurePause, PausingRun } from "../types";
import { ResumeForm } from "./resume-form";

/**
 * What the Health tab's failures check says under its title: what would pause it while nothing
 * does, and while it's paused, what that means, the runs that paused it and Resume.
 */
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
      <p>
        Three failed runs in a row would pause it for everyone until you resume it. Failures from
        one person&apos;s connection or from running out of credits don&apos;t count.
      </p>
    );
  }
  return (
    <>
      <p>
        Its last three runs failed, so new messages start no runs, for everyone who has it on and
        the org switch alike. Their switches stay on. Fix what failed, then resume it; messages that
        arrive until then aren&apos;t run later.
      </p>
      <Table aria-label="Runs that paused it" className="text-foreground">
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
                <Link href={run.href} className="underline underline-offset-4">
                  {run.finishedAt === null ? "Open run" : <DateTime value={run.finishedAt} />}
                </Link>
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
    </>
  );
}
