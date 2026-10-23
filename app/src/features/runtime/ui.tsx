import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RunOnMessageForm, type RunConnectionOption } from "./lib/run-on-message-form";
import { TryItPanel } from "./lib/try-it-panel";
import {
  INTERNAL_ERROR_MESSAGE,
  type RunRecord,
  type RunStatus,
  type RunStepStatus,
} from "./types";

export { RunOnMessageForm, type RunConnectionOption, TryItPanel };

const STATUS_LABELS: Record<RunStatus | RunStepStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  skipped: "Skipped",
  escalated: "Escalated",
  cancelled: "Cancelled",
  failed: "Failed",
  partly_failed: "Partly failed",
  check_failed: "Check failed",
};

function StatusBadge({ status }: { status: RunStatus | RunStepStatus }) {
  const failed = status === "failed" || status === "partly_failed" || status === "check_failed";
  return (
    <Badge variant={failed ? "destructive" : status === "succeeded" ? "secondary" : "outline"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * A failure as people read it. An `internal_error` is ours to fix, whatever message a record
 * from before it said so holds.
 */
function errorText(code: string, message: string | null): string | null {
  return code === "internal_error" ? INTERNAL_ERROR_MESSAGE : message;
}

/** The paths a failed step is on, each once, in the order the run reached them. */
function failedPaths(run: RunRecord): string[] {
  const failed = run.steps.filter((step) => step.status === "failed" && step.path !== null);
  return [...new Set(failed.map((step) => step.path ?? ""))];
}

/**
 * The workflow's recent runs, each with its steps' statuses, and for a run that failed on a
 * path, which path. The real view is M8's.
 */
export function RecentRuns({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Message</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Steps</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="whitespace-normal">
              <DateTime value={run.startedAt} />
            </TableCell>
            <TableCell className="font-mono text-xs break-all whitespace-normal">
              {run.sourceRef}
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-col items-start gap-1">
                <StatusBadge status={run.status} />
                {failedPaths(run).length === 0 ? null : (
                  <span className="text-xs text-destructive">
                    Failed on {failedPaths(run).join(", ")}
                  </span>
                )}
                {run.errorCode === "internal_error" ? (
                  <span className="text-xs text-destructive">{INTERNAL_ERROR_MESSAGE}</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="whitespace-normal">
              <ul className="flex min-w-0 flex-col gap-1 text-xs">
                {run.steps.map((step) => (
                  <li key={step.stepId} className="flex min-w-0 flex-wrap items-center gap-2">
                    <code className="font-mono">{step.stepId}</code>
                    {step.path === null ? null : (
                      <span className="text-muted-foreground">on {step.path}</span>
                    )}
                    <StatusBadge status={step.status} />
                    {step.attempts > 1 ? `${String(step.attempts)} attempts` : null}
                    {step.errorCode === null ? null : (
                      <span className="min-w-0 wrap-anywhere text-destructive">
                        {errorText(step.errorCode, step.errorMessage)}
                      </span>
                    )}
                    {step.output === null ? null : (
                      <code className="block w-full min-w-0 font-mono wrap-anywhere text-muted-foreground">
                        {JSON.stringify(step.output)}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
