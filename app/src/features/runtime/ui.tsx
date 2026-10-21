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
import type { RunRecord, RunStatus, RunStepStatus } from "./types";

export { RunOnMessageForm, type RunConnectionOption, TryItPanel };

const STATUS_LABELS: Record<RunStatus | RunStepStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  skipped: "Skipped",
  escalated: "Escalated",
  cancelled: "Cancelled",
  failed: "Failed",
  check_failed: "Check failed",
};

function StatusBadge({ status }: { status: RunStatus | RunStepStatus }) {
  const failed = status === "failed" || status === "check_failed";
  return (
    <Badge variant={failed ? "destructive" : status === "succeeded" ? "secondary" : "outline"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** The workflow's recent runs, each with its steps' statuses. The real view is M8's. */
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
              {run.startedAt.toLocaleString("en-US")}
            </TableCell>
            <TableCell className="font-mono text-xs break-all whitespace-normal">
              {run.sourceRef}
            </TableCell>
            <TableCell>
              <StatusBadge status={run.status} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <ul className="flex min-w-0 flex-col gap-1 text-xs">
                {run.steps.map((step) => (
                  <li key={step.stepId} className="flex min-w-0 flex-wrap items-center gap-2">
                    <code className="font-mono">{step.stepId}</code>
                    <StatusBadge status={step.status} />
                    {step.attempts > 1 ? `${String(step.attempts)} attempts` : null}
                    {step.errorCode === null ? null : (
                      <span className="min-w-0 wrap-anywhere text-destructive">
                        {step.errorMessage}
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
