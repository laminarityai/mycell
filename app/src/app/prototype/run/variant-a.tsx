// PROTOTYPE, throwaway: one run as a vertical timeline of its steps, top to bottom in the order
// they ran, with the facts and Retry in a rail beside it and the graph after.
import { ExternalLink, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { CheckList, ErrorNote, StatusMark, StepMeta, StepOutput } from "./run-atoms";
import type { RunStep } from "./run-cases";
import { NotYours, RetryButton, RunGraph } from "./run-controls";
import { STEP_STATUS_WORDS, runView, totalCost, totalSeconds, type RunView } from "./run-view";

const RUN_STATUS: Record<string, string> = {
  failed: "Failed",
  succeeded: "Succeeded",
  partly_failed: "Partly failed",
};

export function VariantA({ params }: VariantProps) {
  const view = runView(params);
  const admin = params.as === "admin";
  const { run } = view;
  if (view.hidden) {
    return (
      <PrototypeMain>
        <PrototypeHeader title="Run" admin={admin} />
        <NotYours />
      </PrototypeMain>
    );
  }
  return (
    <PrototypeMain wide>
      <PrototypeHeader title={`Run ${run.id}`} admin={admin}>
        <Badge variant={run.status === "succeeded" ? "secondary" : "destructive"}>
          {RUN_STATUS[run.status]}
        </Badge>
      </PrototypeHeader>
      <p className="text-sm text-muted-foreground">
        <Link href="/prototype/runs" className="underline">
          Runs
        </Link>{" "}
        / {run.workflowName}
      </p>
      {run.error === undefined ? null : <ErrorNote error={run.error} />}
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <ol aria-label="Steps" className="relative flex flex-col">
          {run.steps.map((step, i) => (
            <TimelineStep
              key={step.id}
              step={step}
              full={view.full}
              last={i === run.steps.length - 1}
            />
          ))}
        </ol>
        <Rail view={view} />
      </div>
      <section aria-label="Path" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The path it took</h2>
        <RunGraph spec={run.spec} trace={view.trace} />
      </section>
    </PrototypeMain>
  );
}

function TimelineStep({ step, full, last }: { step: RunStep; full: boolean; last: boolean }) {
  const failed = step.status === "failed" || step.status === "check_failed";
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-4">
      <div className="flex flex-col items-center">
        <StatusMark status={step.status} />
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </div>
      <div
        className={cn("flex flex-col gap-2 pb-8", step.status === "not_reached" && "opacity-55")}
      >
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium">{step.does}</span>
          <code className="text-xs text-muted-foreground">
            {step.id}, {step.type}
          </code>
          <span
            className={cn(
              "ml-auto text-sm",
              failed ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground",
            )}
          >
            {STEP_STATUS_WORDS[step.status]}
          </span>
        </div>
        {step.path === undefined ? null : (
          <p className="text-xs text-muted-foreground">On the {step.path} path</p>
        )}
        <StepMeta step={step} />
        {step.paths === undefined ? null : (
          <ul className="flex flex-col gap-0.5 text-sm">
            {step.paths.map((p) => (
              <li key={p.id} className={p.taken ? "" : "text-muted-foreground"}>
                {p.taken ? "Took" : "Skipped"} {p.name}
                {p.taken && full ? `: ${p.why}` : ""}
              </li>
            ))}
          </ul>
        )}
        <StepOutput step={step} full={full} />
        {step.checks === undefined ? null : <CheckList checks={step.checks} />}
        {step.error === undefined ? null : <ErrorNote error={step.error} />}
      </div>
    </li>
  );
}

function Rail({ view }: { view: RunView }) {
  const { run } = view;
  return (
    <aside className="flex flex-col gap-6 text-sm lg:border-l lg:pl-6">
      <dl className="flex flex-col gap-3">
        <Fact label="Message">
          {view.full ? (
            <>
              <span className="block font-medium">{run.subject}</span>
              <span className="text-muted-foreground">{run.from}</span>
              <a
                href={view.gmailHref}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-center gap-1 underline"
              >
                Open in Gmail <ExternalLink className="size-3" />
              </a>
            </>
          ) : (
            <span className="inline-flex items-start gap-1.5 text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" /> Hidden. It&apos;s in {view.inbox}, so
              you see what happened but not what it read.
            </span>
          )}
        </Fact>
        <Fact label="Inbox">{view.full ? "Your inbox" : view.inbox}</Fact>
        <Fact label="Started">
          <DateTime value={run.startedAt} />
          {run.startedBy === "agent" ? (
            <span className="mt-1 flex items-center gap-1 text-violet-700 dark:text-violet-400">
              <Sparkles className="size-3" /> From Ask Mycel
            </span>
          ) : null}
          {run.startedBy === "retry" ? (
            <span className="mt-1 block text-muted-foreground">A retry of run r-0988</span>
          ) : null}
        </Fact>
        <Fact label="Version">
          <Link href={view.versionHref} className="underline">
            Version {run.version}
          </Link>
          {run.latestVersion > run.version ? (
            <span className="text-muted-foreground">, latest is {run.latestVersion}</span>
          ) : null}
        </Fact>
        <Fact label="Cost">
          {totalCost(run)} credits, {totalSeconds(run)} s
        </Fact>
      </dl>
      <RetryButton retry={view.retry} latestVersion={run.latestVersion} />
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Reviews it created</h2>
        {run.reviews.length === 0 ? (
          <p className="text-muted-foreground">None.</p>
        ) : (
          <ul>
            {run.reviews.map((r) => (
              <li key={r.id}>
                {view.full ? (
                  <Link href="/prototype/review-cards" className="underline">
                    {r.title}
                  </Link>
                ) : (
                  `A review for ${view.owner.name}`
                )}
                <span className="block text-xs text-muted-foreground">{r.state}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
