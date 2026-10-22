"use client";

// PROTOTYPE, throwaway: Runs as an inbox. The list on the left is narrow and quick to walk with
// the mouse; the right shows the selected run's steps, error and cost without leaving the page.
import { Lock, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import {
  STATUS_DOT,
  STATUS_LABEL,
  STATUSES,
  ago,
  connectionOptions,
  workflowOptions,
  type RunRow,
} from "./run-data";
import { RunPreview } from "./run-preview";
import { useRuns } from "./use-runs";

const QUICK = [
  ["", "All"],
  ["failed", "Failed"],
  ["partly_failed", "Partly failed"],
  ["running", "Running"],
] as const;

export function VariantC({ params }: VariantProps) {
  const admin = params.as === "admin";
  const runs = useRuns(params.as, 10);
  const [selected, setSelected] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const current =
    runs.page.find((r) => r.id === selected) ??
    runs.page.find((r) => r.status === "failed") ??
    runs.page.at(0);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Runs" admin={admin} />
      <div className="grid min-h-[640px] grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[22rem_1fr]">
        <aside className="flex flex-col border-b md:border-r md:border-b-0">
          <div className="flex items-center gap-1 border-b p-2">
            {QUICK.map(([status, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  runs.setFilter("status", status);
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  runs.filters.status === status
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-expanded={more}
              aria-label="More filters"
              onClick={() => {
                setMore(!more);
              }}
              className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>
          </div>
          {more ? <MoreFilters runs={runs} admin={admin} /> : null}
          <ol className="flex-1 divide-y overflow-y-auto">
            {runs.page.map((row) => (
              <li key={row.id}>
                <ListItem
                  row={row}
                  admin={admin}
                  on={row.id === current?.id}
                  onSelect={() => {
                    setSelected(row.id);
                  }}
                />
              </li>
            ))}
            {runs.page.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">
                No runs match. Try All.
              </li>
            ) : null}
          </ol>
          <div className="flex items-center justify-between border-t p-2 text-xs">
            <button
              type="button"
              disabled={runs.newer === null}
              className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
              onClick={() => {
                runs.go(runs.newer);
              }}
            >
              Newer
            </button>
            <span className="text-muted-foreground">{String(runs.matching.length)} runs</span>
            <button
              type="button"
              disabled={runs.older === null}
              className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
              onClick={() => {
                runs.go(runs.older);
              }}
            >
              Older
            </button>
          </div>
        </aside>
        <section aria-label="Selected run" className="p-6">
          {current === undefined ? (
            <p className="text-sm text-muted-foreground">Pick a run on the left.</p>
          ) : (
            <RunPreview row={current} as={params.as} admin={admin} />
          )}
        </section>
      </div>
    </PrototypeMain>
  );
}

function ListItem({
  row,
  admin,
  on,
  onSelect,
}: {
  row: RunRow;
  admin: boolean;
  on: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={on}
      className={cn(
        "flex w-full gap-3 border-l-2 px-3 py-2.5 text-left",
        on ? "border-l-foreground bg-muted/60" : "border-l-transparent hover:bg-muted/30",
      )}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT[row.status])} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{row.workflowName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(row.startedAt)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {row.full ? (
            row.subject
          ) : (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" /> Hidden
            </span>
          )}
          {admin ? `, ${row.inbox}` : ""}
        </span>
        <span className="flex gap-1.5 text-[11px] text-muted-foreground">
          {STATUS_LABEL[row.status]}
          {row.startedBy === "agent" ? <span className="text-violet-700">Ask Mycel</span> : null}
          {row.startedBy === "retry" ? <span>Retry</span> : null}
        </span>
      </span>
    </button>
  );
}

function MoreFilters({ runs, admin }: { runs: ReturnType<typeof useRuns>; admin: boolean }) {
  const select = "h-7 w-full rounded-md border bg-background px-2 text-xs";
  return (
    <div className="flex flex-col gap-2 border-b bg-muted/20 p-3">
      <select
        aria-label="Workflow"
        className={select}
        value={runs.filters.workflow}
        onChange={(e) => {
          runs.setFilter("workflow", e.target.value);
        }}
      >
        <option value="">All workflows</option>
        {workflowOptions(runs.all).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Status"
        className={select}
        value={runs.filters.status}
        onChange={(e) => {
          runs.setFilter("status", e.target.value);
        }}
      >
        <option value="">Any status</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {admin ? (
        <select
          aria-label="Inbox"
          className={select}
          value={runs.filters.connection}
          onChange={(e) => {
            runs.setFilter("connection", e.target.value);
          }}
        >
          <option value="">Every inbox</option>
          {connectionOptions(runs.all).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
