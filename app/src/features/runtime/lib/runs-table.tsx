// The Runs page's table, one dense row a run, and the filter bar and paging around it. Filters
// and the page live in the address, so the bar is a plain GET form and paging plain links.
import { Lock } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  INTERNAL_ERROR_MESSAGE,
  type RunFilterOptions,
  type RunFilters,
  type RunInbox,
  type RunListItem,
  type RunPage,
  type RunStatus,
} from "../types";
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

/** The status filter's choices, in the order the spec lists them. */
const FILTER_STATUSES = Object.keys(RUN_STATUS_LABELS) as RunStatus[];

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

/** Whether any filter is set. */
export function isFiltered(filters: RunFilters): boolean {
  return [filters.workflowId, filters.status, filters.connectionId].some(
    (value) => value !== undefined,
  );
}

/** The Runs page's address for these filters and, optionally, a page. */
export function runsHref(filters: RunFilters, page: { older?: string; newer?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.workflowId !== undefined) query.set("workflow", filters.workflowId);
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.connectionId !== undefined) query.set("connection", filters.connectionId);
  if (page.older !== undefined) query.set("older", page.older);
  if (page.newer !== undefined) query.set("newer", page.newer);
  const text = query.toString();
  return text === "" ? "/runs" : `/runs?${text}`;
}

// Credits to two places at most: a run's cost is often a fraction of one.
function credits(amount: number): string {
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
              <span className={cn("inline-flex items-center gap-1.5", STATUS_TEXT[run.status])}>
                <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[run.status])} />
                {RUN_STATUS_LABELS[run.status]}
              </span>
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal">
              <Failures run={run} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{credits(run.costCredits)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MessageCell({ run }: { run: RunListItem }) {
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
    <span className="block truncate">
      <span className="font-medium">{run.message.subject || "(no subject)"}</span>
      {run.message.from === null ? null : (
        <span className="ml-2 text-muted-foreground">{run.message.from}</span>
      )}
    </span>
  );
}

/**
 * A failure as people read it. An `internal_error` is ours to fix, whatever message a record
 * from before it said so holds.
 */
function errorText(code: string | null, message: string | null): string | null {
  return code === "internal_error" ? INTERNAL_ERROR_MESSAGE : message;
}

function Failures({ run }: { run: RunListItem }) {
  // The run failed as a whole (its job crashed), not at one of its steps.
  const runError = errorText(run.errorCode, null);
  if (run.failures.length === 0) {
    if (runError !== null) return <span className="text-xs text-destructive">{runError}</span>;
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {run.failures.map((failure) => {
        const text = errorText(failure.errorCode, failure.errorMessage);
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

/**
 * The filters, as a GET form so they stay in the address. The inbox filter is for admins, who
 * see more than their own.
 */
export function RunFilterBar({
  filters,
  options,
  showInbox,
}: {
  filters: RunFilters;
  options: RunFilterOptions;
  showInbox: boolean;
}) {
  const filtered = isFiltered(filters);
  return (
    <form
      method="get"
      action="/runs"
      aria-label="Filter runs"
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3"
    >
      <Filter
        name="workflow"
        label="Workflow"
        value={filters.workflowId}
        any="All workflows"
        options={options.workflows.map((workflow) => ({ id: workflow.id, label: workflow.name }))}
      />
      <Filter
        name="status"
        label="Status"
        value={filters.status}
        any="Any status"
        options={FILTER_STATUSES.map((status) => ({
          id: status,
          label: RUN_STATUS_LABELS[status],
        }))}
      />
      {showInbox ? (
        <Filter
          name="connection"
          label="Inbox"
          value={filters.connectionId}
          any="Every inbox"
          options={options.connections.map((connection) => ({
            id: connection.id,
            label: inboxLabel(connection.inbox),
          }))}
        />
      ) : null}
      <Button type="submit" size="sm">
        Filter
      </Button>
      {filtered ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/runs">Clear filters</Link>
        </Button>
      ) : null}
    </form>
  );
}

function Filter({
  name,
  label,
  value,
  any,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  any: string;
  options: { id: string; label: string }[];
}) {
  const id = `runs-filter-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {/* Keyed by its value, so following a link resets it to the address's choice. */}
      <NativeSelect key={value ?? ""} id={id} name={name} size="sm" defaultValue={value ?? ""}>
        <NativeSelectOption value="">{any}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Newer and Older, keeping the filters. */
export function RunPager({ filters, page }: { filters: RunFilters; page: RunPage }) {
  return (
    <nav aria-label="Pages of runs" className="flex items-center justify-between">
      <PageLink
        label="Newer"
        href={page.newer === null ? null : runsHref(filters, { newer: page.newer })}
      />
      <PageLink
        label="Older"
        href={page.older === null ? null : runsHref(filters, { older: page.older })}
      />
    </nav>
  );
}

function PageLink({ label, href }: { label: string; href: string | null }) {
  if (href === null) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  );
}
