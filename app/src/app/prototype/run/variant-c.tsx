"use client";

// PROTOTYPE, throwaway: one run told in plain words first: what happened and what to do, with
// Retry right under it. The steps sit in a table you open when you want the detail, and the
// graph behind a second fold.
import { ChevronDown, ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { DateTime } from "@/components/date-time";
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
import { CheckList, ErrorNote, StatusMark, StepOutput } from "./run-atoms";
import { NotYours, RetryButton, RunGraph } from "./run-controls";
import { storyOf } from "./run-story";
import { STEP_STATUS_WORDS, isStepFailure, runView, totalCost } from "./run-view";

export function VariantC({ params }: VariantProps) {
  const view = runView(params);
  const admin = params.as === "admin";
  const { run } = view;
  const [stepsOpen, setStepsOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (view.hidden) {
    return (
      <PrototypeMain>
        <PrototypeHeader title="Run" admin={admin} />
        <NotYours />
      </PrototypeMain>
    );
  }
  const story = storyOf(view);
  const failed = run.status !== "succeeded";
  return (
    <PrototypeMain>
      <PrototypeHeader title="What happened" admin={admin} />
      <article className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {run.workflowName}, run {run.id}, <DateTime value={run.startedAt} />
          {run.startedBy === "agent" ? ", started from Ask Mycel" : ""}
          {run.startedBy === "retry" ? ", a retry of r-0988" : ""}
        </p>
        <h2
          className={cn(
            "text-3xl leading-tight font-semibold tracking-tight text-balance",
            failed && "text-red-800 dark:text-red-300",
          )}
        >
          {story.headline}
        </h2>
        <div className="flex flex-col gap-2 text-base leading-relaxed">
          {story.sentences.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4">
          <p>
            <span className="font-medium">What to do: </span>
            {story.next}
          </p>
          <RetryButton retry={view.retry} latestVersion={run.latestVersion} />
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {view.full ? (
            <a
              href={view.gmailHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Open the message in Gmail <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock className="size-3" /> The message stays private to {view.owner.name}
            </span>
          )}
          <Link href={view.versionHref} className="underline">
            Ran version {run.version}
            {run.latestVersion > run.version ? ` (latest is ${String(run.latestVersion)})` : ""}
          </Link>
          {run.reviews.map((r) =>
            view.full ? (
              <Link key={r.id} href="/prototype/review-cards" className="underline">
                Review: {r.title}
              </Link>
            ) : (
              <span key={r.id}>A review for {view.owner.name}</span>
            ),
          )}
          <span className="text-muted-foreground">{totalCost(run)} credits</span>
        </p>
      </article>
      <Fold
        open={stepsOpen}
        onToggle={() => {
          setStepsOpen(!stepsOpen);
        }}
        title={`Steps (${String(run.steps.length)})`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Step</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tries</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Credits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.steps.map((step) => {
              const detail =
                step.error !== undefined || step.checks !== undefined || step.output !== undefined;
              const open = expanded === step.id || (expanded === null && isStepFailure(step));
              return (
                <Fragment key={step.id}>
                  <TableRow
                    className={cn(
                      detail && "cursor-pointer",
                      step.status === "not_reached" && "text-muted-foreground",
                    )}
                    onClick={() => {
                      if (detail) setExpanded(open ? "" : step.id);
                    }}
                  >
                    <TableCell>
                      <StatusMark status={step.status} className="size-5" />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{step.id}</code>
                      <span className="block text-xs text-muted-foreground">{step.does}</span>
                    </TableCell>
                    <TableCell>{STEP_STATUS_WORDS[step.status]}</TableCell>
                    <TableCell className="tabular-nums">{step.attempts || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {step.model === undefined ? "—" : `${step.role ?? ""}, ${step.model}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{step.cost}</TableCell>
                  </TableRow>
                  {open && detail ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={5} className="flex-col whitespace-normal">
                        <div className="flex flex-col gap-2 py-1">
                          {step.error === undefined ? null : <ErrorNote error={step.error} />}
                          {step.checks === undefined ? null : <CheckList checks={step.checks} />}
                          <StepOutput step={step} full={view.full} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Fold>
      <Fold
        open={graphOpen}
        onToggle={() => {
          setGraphOpen(!graphOpen);
        }}
        title="The path on the workflow"
      >
        <RunGraph spec={run.spec} trace={view.trace} />
      </Fold>
    </PrototypeMain>
  );
}

function Fold({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-2 text-left font-medium"
      >
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open ? children : null}
    </section>
  );
}
