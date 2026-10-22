// PROTOTYPE, throwaway: variant C's right pane, one run at a glance: its steps as a row of
// stops, where it stopped and why, what it cost, and a way into the full run page.
import { Check, Circle, Lock, X } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_TEXT,
  ago,
  credits,
  previewSteps,
  runHref,
  type RunRow,
} from "./run-data";

export function RunPreview({ row, as, admin }: { row: RunRow; as: string; admin: boolean }) {
  const steps = previewSteps(row);
  return (
    <article className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className={cn("text-sm font-medium", STATUS_TEXT[row.status])}>
          {STATUS_LABEL[row.status]}, {ago(row.startedAt)}
        </p>
        <h2 className="text-xl font-semibold tracking-tight">{row.workflowName}</h2>
        {row.full ? (
          <p className="text-sm">
            {row.subject} <span className="text-muted-foreground">from {row.from}</span>
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" /> On {row.inbox}&apos;s own inbox, so you see what happened
            but not the message or what each step found.
          </p>
        )}
      </header>
      <ol className="flex flex-wrap items-center gap-2" aria-label="Steps">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            {i === 0 ? null : <span className="h-px w-4 bg-border" />}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs",
                step.state === "failed" && "border-red-300 bg-red-50 text-red-800 dark:bg-red-950",
                step.state === "not_reached" && "border-dashed text-muted-foreground",
                step.state === "running" && "border-blue-300 text-blue-800",
              )}
            >
              {step.state === "done" ? <Check className="size-3 text-emerald-600" /> : null}
              {step.state === "failed" ? <X className="size-3" /> : null}
              {step.state === "not_reached" || step.state === "running" ? (
                <Circle className="size-2.5" />
              ) : null}
              {step.id}
            </span>
          </li>
        ))}
      </ol>
      {row.errorText === undefined ? null : (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-4 text-sm dark:bg-red-950/40">
          <p className="font-medium">Stopped at {row.failedStep}</p>
          <p>{row.errorText}</p>
        </div>
      )}
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Started</dt>
        <dd>
          <DateTime value={row.startedAt} />
        </dd>
        {admin ? (
          <>
            <dt className="text-muted-foreground">Inbox</dt>
            <dd>{row.inbox}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Took</dt>
        <dd>{(row.durationMs / 1000).toFixed(1)} s</dd>
        <dt className="text-muted-foreground">Cost</dt>
        <dd>{credits(row.cost)}</dd>
        <dt className="text-muted-foreground">Started by</dt>
        <dd>
          {row.startedBy === "agent"
            ? "Ask Mycel, from a chat"
            : row.startedBy === "retry"
              ? "A retry of run r-0988"
              : "A new email arriving"}
        </dd>
      </dl>
      <div>
        <Button asChild>
          <Link href={runHref(row, as, "C")}>Open run {row.id}</Link>
        </Button>
      </div>
    </article>
  );
}
