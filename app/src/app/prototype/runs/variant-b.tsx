"use client";

// PROTOTYPE, throwaway: Runs grouped by workflow. Each workflow is one line with a health strip
// of its last runs as dots, so a failing streak shows before any run is opened; a line expands
// to that workflow's runs, paged on its own.
import { ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAUSED_TEXT, WORKFLOWS } from "../_shared/fixtures";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import {
  STATUS_DOT,
  STATUS_LABEL,
  STATUSES,
  ago,
  connectionOptions,
  credits,
  isFailure,
  pageOf,
  runHref,
  type Cursor,
  type RunRow,
} from "./run-data";
import { useRuns } from "./use-runs";

const STRIP = 12;

export function VariantB({ params }: VariantProps) {
  const admin = params.as === "admin";
  const runs = useRuns(params.as, 1000);
  const groups = WORKFLOWS.map((workflow) => ({
    workflow,
    recent: runs.all.filter((r) => r.workflowId === workflow.id).slice(0, STRIP),
    matching: runs.matching.filter((r) => r.workflowId === workflow.id),
  })).filter((g) => g.recent.length > 0);
  const [open, setOpen] = useState<string | null>("wf-followups");
  return (
    <PrototypeMain>
      <PrototypeHeader title="Runs" admin={admin} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
          <Chip
            on={runs.filters.status === ""}
            onClick={() => {
              runs.setFilter("status", "");
            }}
          >
            Any status
          </Chip>
          {STATUSES.map((s) => (
            <Chip
              key={s}
              on={runs.filters.status === s}
              onClick={() => {
                runs.setFilter("status", runs.filters.status === s ? "" : s);
              }}
            >
              <span className={cn("size-2 rounded-full", STATUS_DOT[s])} />
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
        {admin ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Inbox">
            <Chip
              on={runs.filters.connection === ""}
              onClick={() => {
                runs.setFilter("connection", "");
              }}
            >
              Every inbox
            </Chip>
            {connectionOptions(runs.all).map((c) => (
              <Chip
                key={c.id}
                on={runs.filters.connection === c.id}
                onClick={() => {
                  runs.setFilter("connection", runs.filters.connection === c.id ? "" : c.id);
                }}
              >
                {c.label}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {groups.map(({ workflow, recent, matching }) => {
          const expanded = open === workflow.id;
          const failed = recent.filter((r) => isFailure(r.status)).length;
          return (
            <li key={workflow.id}>
              <button
                type="button"
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left hover:bg-muted/40"
                onClick={() => {
                  setOpen(expanded ? null : workflow.id);
                }}
              >
                <ChevronRight
                  className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")}
                />
                <span className="flex min-w-48 flex-1 flex-col">
                  <span className="font-medium">{workflow.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {failed === 0
                      ? `No failures in its last ${String(recent.length)} runs`
                      : `${String(failed)} of its last ${String(recent.length)} runs failed`}
                  </span>
                </span>
                {workflow.paused === null ? null : (
                  <Badge variant={workflow.paused === "failures" ? "destructive" : "outline"}>
                    Paused: {PAUSED_TEXT[workflow.paused]}
                  </Badge>
                )}
                <HealthStrip runs={recent} />
              </button>
              {expanded ? (
                <GroupRuns
                  key={runs.filters.status + runs.filters.connection}
                  rows={matching}
                  as={params.as}
                  admin={admin}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </PrototypeMain>
  );
}

/** Oldest on the left, newest on the right, as a streak reads. */
function HealthStrip({ runs }: { runs: RunRow[] }) {
  return (
    <span className="flex items-center gap-1" aria-label="Last runs, oldest first">
      {[...runs].reverse().map((r) => (
        <span
          key={r.id}
          title={`${STATUS_LABEL[r.status]}, ${ago(r.startedAt)}`}
          className={cn("h-4 w-2 rounded-sm", STATUS_DOT[r.status])}
        />
      ))}
    </span>
  );
}

function GroupRuns({ rows, as, admin }: { rows: RunRow[]; as: string; admin: boolean }) {
  const [cursor, setCursor] = useState<Cursor>(null);
  const { page, newer, older } = pageOf(rows, cursor, 5);
  if (rows.length === 0) {
    return <p className="px-12 pb-4 text-sm text-muted-foreground">No runs match these filters.</p>;
  }
  return (
    <div className="flex flex-col gap-2 bg-muted/20 px-4 pb-4 pl-12">
      <ol className="flex flex-col divide-y rounded-md border bg-background">
        {page.map((row) => (
          <li key={row.id}>
            <Link
              href={runHref(row, as, "B")}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-3 p-3 text-sm hover:bg-muted/40"
            >
              <span className={cn("mt-1.5 size-2 rounded-full", STATUS_DOT[row.status])} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  {row.full ? (
                    row.subject
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Lock className="size-3" /> Message hidden
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABEL[row.status]}
                  {admin ? `, ${row.inbox}` : ""}
                  {row.startedBy === "agent" ? ", started from Ask Mycel" : ""}
                  {row.startedBy === "retry" ? ", a retry" : ""}
                </span>
                {row.failedStep === undefined ? null : (
                  <span className="text-xs text-red-700 dark:text-red-400">
                    Stopped at {row.failedStep}: {row.errorText}
                  </span>
                )}
              </span>
              <span className="flex flex-col items-end text-xs text-muted-foreground">
                <span>{ago(row.startedAt)}</span>
                <span className="tabular-nums">{credits(row.cost)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="xs"
          disabled={newer === null}
          onClick={() => {
            setCursor(newer);
          }}
        >
          Newer
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={older === null}
          onClick={() => {
            setCursor(older);
          }}
        >
          Older
        </Button>
      </div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs",
        on ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
