"use client";

// PROTOTYPE, throwaway: Runs as a dense table under one filter bar, paged Newer/Older. The
// table is the whole page: scan many runs at once, one row each.
import { Lock, Sparkles, RotateCcw } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import {
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_TEXT,
  STATUSES,
  ago,
  connectionOptions,
  credits,
  runHref,
  workflowOptions,
  type RunRow,
} from "./run-data";
import { useRuns } from "./use-runs";

const SELECT =
  "h-8 rounded-md border bg-background px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function VariantA({ params }: VariantProps) {
  const admin = params.as === "admin";
  const runs = useRuns(params.as, 12);
  const filtered = runs.filters.workflow + runs.filters.status + runs.filters.connection !== "";
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Runs" admin={admin} />
      <p className="text-sm text-muted-foreground">
        {admin
          ? "Every run in the company, newest first. Runs on a colleague's own inbox show what happened, not what it read."
          : "Runs of workflows on your inbox, newest first."}
      </p>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <Filter
          label="Workflow"
          value={runs.filters.workflow}
          onChange={(v) => {
            runs.setFilter("workflow", v);
          }}
          options={workflowOptions(runs.all)}
          any="All workflows"
        />
        <Filter
          label="Status"
          value={runs.filters.status}
          onChange={(v) => {
            runs.setFilter("status", v);
          }}
          options={STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))}
          any="Any status"
        />
        {admin ? (
          <Filter
            label="Inbox"
            value={runs.filters.connection}
            onChange={(v) => {
              runs.setFilter("connection", v);
            }}
            options={connectionOptions(runs.all)}
            any="Every inbox"
          />
        ) : null}
        <span className="ml-auto text-sm text-muted-foreground">
          {String(runs.matching.length)} {runs.matching.length === 1 ? "run" : "runs"}
          {filtered ? " match" : ""}
        </span>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={runs.clear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {runs.page.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No runs match these filters. Clear one to see more.
        </p>
      ) : (
        <Table aria-label="Runs">
          <TableHeader>
            <TableRow>
              <TableHead>Message</TableHead>
              <TableHead>Workflow</TableHead>
              {admin ? <TableHead>Inbox</TableHead> : null}
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Failed step</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.page.map((row) => (
              <Row key={row.id} row={row} as={params.as} admin={admin} />
            ))}
          </TableBody>
        </Table>
      )}
      <nav aria-label="Pages" className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={runs.newer === null}
          onClick={() => {
            runs.go(runs.newer);
          }}
        >
          Newer
        </Button>
        <span className="text-xs text-muted-foreground">12 a page</span>
        <Button
          variant="outline"
          size="sm"
          disabled={runs.older === null}
          onClick={() => {
            runs.go(runs.older);
          }}
        >
          Older
        </Button>
      </nav>
    </PrototypeMain>
  );
}

function Row({ row, as, admin }: { row: RunRow; as: string; admin: boolean }) {
  const href = runHref(row, as, "A");
  return (
    <TableRow className="text-sm">
      <TableCell className="max-w-72">
        <Link href={href} className="block truncate hover:underline">
          {row.full ? (
            <>
              <span className="font-medium">{row.subject}</span>
              <span className="ml-2 text-muted-foreground">{row.from}</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Lock className="size-3.5" /> Message hidden: {row.inbox}&apos;s inbox
            </span>
          )}
        </Link>
        <Origin row={row} />
      </TableCell>
      <TableCell>{row.workflowName}</TableCell>
      {admin ? <TableCell className="text-muted-foreground">{row.inbox}</TableCell> : null}
      <TableCell>
        <span className="block">{ago(row.startedAt)}</span>
        <span className="text-xs text-muted-foreground">
          <DateTime value={row.startedAt} />
        </span>
      </TableCell>
      <TableCell>
        <span className={cn("inline-flex items-center gap-1.5", STATUS_TEXT[row.status])}>
          <span className={cn("size-2 rounded-full", STATUS_DOT[row.status])} />
          {STATUS_LABEL[row.status]}
        </span>
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal">
        {row.failedStep === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <code className="text-xs">{row.failedStep}</code>
            <span className="block text-xs text-muted-foreground">{row.errorText}</span>
          </>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{credits(row.cost)}</TableCell>
    </TableRow>
  );
}

function Origin({ row }: { row: RunRow }) {
  if (row.startedBy === "agent") {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-400">
        <Sparkles className="size-3" /> Started from Ask Mycel
      </span>
    );
  }
  if (row.startedBy === "retry") {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <RotateCcw className="size-3" /> Retry of r-0988
      </span>
    );
  }
  return null;
}

function Filter({
  label,
  value,
  onChange,
  options,
  any,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  any: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        className={SELECT}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
