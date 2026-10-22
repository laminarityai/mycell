// PROTOTYPE, throwaway: what the Runs page reads from the shared fixtures, as `listRuns` would
// give it: who may see which runs, which are shown in full, filters, and keyset paging.
import {
  CONNECTIONS,
  NOW,
  PEOPLE,
  RUNS,
  WORKFLOWS,
  viewerFor,
  type Connection,
  type Person,
  type Run,
  type RunStatus,
} from "../_shared/fixtures";

export const STATUS_LABEL: Record<RunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  partly_failed: "Partly failed",
  escalated: "Escalated",
  skipped: "Skipped",
  cancelled: "Cancelled",
  running: "Running",
};

/** The order the status filter offers them, as the spec lists them. */
export const STATUSES: RunStatus[] = [
  "succeeded",
  "failed",
  "partly_failed",
  "escalated",
  "skipped",
  "cancelled",
  "running",
];

/** One colour per status, used as a dot, a bar or a text tint. */
export const STATUS_DOT: Record<RunStatus, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-red-600",
  partly_failed: "bg-amber-500",
  escalated: "bg-sky-500",
  skipped: "bg-zinc-300 dark:bg-zinc-600",
  cancelled: "bg-zinc-400",
  running: "bg-blue-500 animate-pulse",
};

export const STATUS_TEXT: Record<RunStatus, string> = {
  succeeded: "text-emerald-700 dark:text-emerald-400",
  failed: "text-red-700 dark:text-red-400",
  partly_failed: "text-amber-700 dark:text-amber-400",
  escalated: "text-sky-700 dark:text-sky-400",
  skipped: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  running: "text-blue-700 dark:text-blue-400",
};

export const isFailure = (status: RunStatus) => status === "failed" || status === "partly_failed";

export type RunRow = Run & {
  workflowName: string;
  connection: Connection;
  /** Whose inbox, in words: "Tom Becker" or "orders@fernhill.co (shared)". */
  inbox: string;
  /** Subject, sender and Gmail link are shown: the viewer reads this run's connection. */
  full: boolean;
};

const personById = (id: string | undefined): Person | undefined =>
  Object.values(PEOPLE).find((p) => p.id === id);

function connectionOf(id: string): Connection {
  return CONNECTIONS.find((c) => c.id === id) ?? CONNECTIONS[0];
}

export function inboxWords(connection: Connection, viewer: Person): string {
  if (connection.kind === "org") return `${connection.label} (shared)`;
  if (connection.ownerId === viewer.id) return "Your inbox";
  return personById(connection.ownerId)?.name ?? connection.label;
}

/** The runs the viewer may see: every run for an admin, a member's own inbox's for a member. */
export function visibleRuns(as: string): RunRow[] {
  const viewer = viewerFor(as);
  return RUNS.flatMap((run): RunRow[] => {
    const connection = connectionOf(run.connectionId);
    const own = connection.kind === "member" && connection.ownerId === viewer.id;
    if (viewer.role === "member" && !own) return [];
    const full = own || (connection.kind === "org" && viewer.role === "admin");
    const workflowName = WORKFLOWS.find((w) => w.id === run.workflowId)?.name ?? run.workflowId;
    return [{ ...run, workflowName, connection, inbox: inboxWords(connection, viewer), full }];
  });
}

/** The connections the viewer's runs are on, for the connection filter. */
export function connectionOptions(rows: RunRow[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.connection.id, row.inbox);
  return [...seen].map(([id, label]) => ({ id, label }));
}

export function workflowOptions(rows: RunRow[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.workflowId, row.workflowName);
  return [...seen].map(([id, label]) => ({ id, label }));
}

export type RunFilters = { workflow: string; status: string; connection: string };
export const NO_FILTERS: RunFilters = { workflow: "", status: "", connection: "" };

export function filterRuns(rows: RunRow[], filters: RunFilters): RunRow[] {
  return rows.filter(
    (row) =>
      (filters.workflow === "" || row.workflowId === filters.workflow) &&
      (filters.status === "" || row.status === filters.status) &&
      (filters.connection === "" || row.connectionId === filters.connection),
  );
}

/**
 * Keyset paging, newest first: a page is the `size` rows older than a cursor (the last row's
 * ID) or newer than one (the first row's). No offsets, so it stays fast with thousands of runs.
 */
export type Cursor = { after: string } | { before: string } | null;

export function pageOf(rows: RunRow[], cursor: Cursor, size: number) {
  let start = 0;
  if (cursor !== null && "after" in cursor) {
    start = rows.findIndex((r) => r.id === cursor.after) + 1;
  } else if (cursor !== null) {
    start = Math.max(0, rows.findIndex((r) => r.id === cursor.before) - size);
  }
  const page = rows.slice(start, start + size);
  const first = page.at(0);
  const last = page.at(-1);
  return {
    page,
    newer: start > 0 && first !== undefined ? { before: first.id } : null,
    older: start + size < rows.length && last !== undefined ? { after: last.id } : null,
  };
}

/** "4 min ago", "3 h ago", "2 days ago", from the prototypes' fixed now. */
export function ago(date: Date): string {
  const minutes = Math.round((NOW.getTime() - date.getTime()) / 60_000);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${String(days)} days ago`;
}

/** How the run started, when it wasn't the workflow's trigger. */
export function startedByWords(run: Run): string | null {
  if (run.startedBy === "agent") return "From Ask Mycel";
  if (run.startedBy === "retry") return "Retry";
  if (run.startedBy === "admin") return "Run by an admin";
  return null;
}

export function credits(n: number): string {
  return n === 1 ? "1 credit" : `${String(n)} credits`;
}

/** The run page, in the view this row would open in. */
export function runHref(row: RunRow, as: string, variant?: string): string {
  const view = row.full ? "full" : "redacted";
  const params = new URLSearchParams({ as, view });
  if (variant !== undefined) params.set("variant", variant);
  if (row.failedStep === "extract-order") params.set("run", "check-failed");
  else if (row.failedStep === "lookup-price") params.set("run", "access-refused");
  else if (row.status === "succeeded") params.set("run", "succeeded");
  return `/prototype/run?${params.toString()}`;
}

/** A plausible step list for a run, for previews: which step it stopped at. */
const STEPS: Record<string, string[]> = {
  "wf-quotes": ["kind", "route", "details", "lookup-price", "reply", "reply-approval"],
  "wf-invoices": ["is-invoice", "add-label"],
  "wf-calls": ["kind", "find-slot", "reply", "reply-approval"],
  "wf-status": ["numbers", "append-row"],
  "wf-followups": ["is-order", "route", "extract-order", "add-followup"],
};

export type PreviewStep = { id: string; state: "done" | "failed" | "not_reached" | "running" };

export function previewSteps(run: Run): PreviewStep[] {
  const ids = STEPS[run.workflowId] ?? [];
  const stopAt =
    run.failedStep !== undefined
      ? ids.indexOf(run.failedStep)
      : run.status === "running"
        ? 1
        : run.status === "skipped"
          ? 1
          : ids.length;
  return ids.map((id, i): PreviewStep => {
    if (i < stopAt) return { id, state: "done" };
    if (i === stopAt && run.failedStep !== undefined) return { id, state: "failed" };
    if (i === stopAt && run.status === "running") return { id, state: "running" };
    return { id, state: "not_reached" };
  });
}
