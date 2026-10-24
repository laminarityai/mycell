// The Runs page's table, one dense row a run, each opening the run's page; and how a run's
// status, inbox and cost read, here and on its page.
import { Lock } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { failureMessage } from "../failure-texts";
import type { RunInbox, RunListItem, RunStatus } from "../types";
import { FromAskMycel } from "./from-ask-mycel";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  partly_failed: "Partly failed",
  escalated: "Escalated",
  skipped: "Skipped",
  cancelled: "Cancelled",
  running: "Running",
};

const STATUS_DOT: Record<RunStatus, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
  partly_failed: "bg-amber-500",
  escalated: "bg-sky-500",
  skipped: "bg-muted-foreground/40",
  cancelled: "bg-muted-foreground/60",
  running: "bg-blue-500",
};

const STATUS_TEXT: Record<RunStatus, string> = {
  succeeded: "text-emerald-700 dark:text-emerald-400",
  failed: "text-destructive",
  partly_failed: "text-amber-700 dark:text-amber-400",
  escalated: "text-sky-700 dark:text-sky-400",
  skipped: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  running: "text-blue-700 dark:text-blue-400",
};

/** Whose inbox, in words. */
export function inboxLabel(inbox: RunInbox): string {
  switch (inbox.kind) {
    case "yours":
      return `Your inbox (${inbox.accountEmail})`;
    case "org":
      return `${inbox.accountEmail} (shared)`;
    case "colleague":
      return inbox.ownerName;
  }
}

// Credits to two places at most: a run's cost is often a fraction of one.
export function creditsText(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}

/** Runs, one row each: what ran, on whose inbox, when, how it ended, and what it cost. */
export function RunsTable({ runs, showInbox }: { runs: RunListItem[]; showInbox: boolean }) {
  return (
    <Table aria-label="Runs">
      <TableHeader>
        <TableRow>
          <TableHead>Message</TableHead>
          <TableHead>Workflow</TableHead>
          {showInbox ? <TableHead>Inbox</TableHead> : null}
          <TableHead>Started</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Failed step</TableHead>
          <TableHead className="text-right">Credits</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="text-sm">
            <TableCell className="max-w-72 whitespace-normal">
              <MessageCell run={run} />
            </TableCell>
            <TableCell className="whitespace-normal">
              {run.workflowName}
              {run.startedBy === "agent" ? <FromAskMycel /> : null}
            </TableCell>
            {showInbox ? (
              <TableCell className="whitespace-normal text-muted-foreground">
                {inboxLabel(run.inbox)}
              </TableCell>
            ) : null}
            <TableCell className="text-xs whitespace-normal">
              <DateTime value={run.startedAt} />
            </TableCell>
            <TableCell>
              <RunStatusLabel status={run.status} />
              {run.startedBy === "retry" ? (
                <span className="block text-xs text-muted-foreground">A retry</span>
              ) : null}
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal">
              <Failures run={run} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {creditsText(run.costCredits)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A run's status, with its colour. */
export function RunStatusLabel({ status }: { status: RunStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", STATUS_TEXT[status])}>
      <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[status])} />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** A run's own page. */
export function runHref(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}`;
}

// The message, which opens the run's page.
function MessageCell({ run }: { run: RunListItem }) {
  return (
    <Link href={runHref(run.id)} className="block truncate underline-offset-4 hover:underline">
      <MessageText run={run} />
    </Link>
  );
}

function MessageText({ run }: { run: RunListItem }) {
  if (run.message === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        Message hidden: {inboxLabel(run.inbox)}&apos;s inbox
      </span>
    );
  }
  if (run.message.subject === null) {
    return <span className="text-muted-foreground">Message not available in Gmail</span>;
  }
  return (
    <>
      <span className="font-medium">{run.message.subject || "(no subject)"}</span>
      {run.message.from === null ? null : (
        <span className="ml-2 text-muted-foreground">{run.message.from}</span>
      )}
    </>
  );
}

function Failures({ run }: { run: RunListItem }) {
  // The run failed as a whole (its job crashed), not at one of its steps.
  const runError = failureMessage(run.errorCode, null);
  if (run.failures.length === 0) {
    if (runError !== null) return <span className="text-xs text-destructive">{runError}</span>;
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {run.failures.map((failure) => {
        const text = failureMessage(failure.errorCode, failure.errorMessage);
        return (
          <li key={failure.stepId}>
            <code className="font-mono text-xs">{failure.stepId}</code>
            {failure.path === null ? null : (
              <span className="text-xs text-muted-foreground"> on {failure.path}</span>
            )}
            {text === null ? null : (
              <span className="block text-xs wrap-anywhere text-muted-foreground">{text}</span>
            )}
          </li>
        );
      })}
      {runError === null ? null : <li className="text-xs text-destructive">{runError}</li>}
    </ul>
  );
}
