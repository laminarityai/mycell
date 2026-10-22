"use client";

// PROTOTYPE, throwaway: one run, graph first. The real workflow graph fills the page with the
// run's path lit; clicking a box (or a step in the strip under it) opens that step's details in
// a panel over the graph's edge. The failed step opens first.
import { ExternalLink, Lock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { CheckList, ErrorNote, StatusMark, StepMeta, StepOutput } from "./run-atoms";
import type { RunStep } from "./run-cases";
import { NotYours, RetryButton, RunGraph } from "./run-controls";
import { STEP_STATUS_WORDS, failedStep, runView, totalCost, type RunView } from "./run-view";

export function VariantB({ params }: VariantProps) {
  const view = runView(params);
  const admin = params.as === "admin";
  const { run } = view;
  const [selected, setSelected] = useState<string | null>(
    (failedStep(run) ?? run.steps.at(-1))?.id ?? null,
  );
  const frame = useRef<HTMLDivElement>(null);
  // React Flow marks each box with its node ID ("step:extract-order"); a click on one selects it.
  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const pick = (event: MouseEvent) => {
      const node = (event.target as HTMLElement).closest(".react-flow__node");
      const [kind, stepId] = (node?.getAttribute("data-id") ?? "").split(":");
      if (kind === "step" && run.steps.some((s) => s.id === stepId)) setSelected(stepId);
      if (kind === "path") setSelected(run.steps.find((s) => s.type === "branch")?.id ?? null);
    };
    element.addEventListener("click", pick);
    return () => {
      element.removeEventListener("click", pick);
    };
  }, [run]);
  if (view.hidden) {
    return (
      <PrototypeMain>
        <PrototypeHeader title="Run" admin={admin} />
        <NotYours />
      </PrototypeMain>
    );
  }
  const step = run.steps.find((s) => s.id === selected);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title={run.workflowName} admin={admin} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border px-4 py-3 text-sm">
        <span
          className={cn(
            "font-semibold",
            run.status === "succeeded" ? "text-emerald-700" : "text-red-700 dark:text-red-400",
          )}
        >
          Run {run.id} {run.status === "succeeded" ? "succeeded" : "failed"}
        </span>
        <span className="text-muted-foreground">
          <DateTime value={run.startedAt} />
        </span>
        <span>{view.full ? "Your inbox" : view.inbox}</span>
        {view.full ? (
          <a
            href={view.gmailHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            {run.subject} <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Lock className="size-3" /> Message hidden
          </span>
        )}
        <Link href={view.versionHref} className="underline">
          Version {run.version}
        </Link>
        <span>{totalCost(run)} credits</span>
        {run.startedBy === "agent" ? <span className="text-violet-700">From Ask Mycel</span> : null}
        {run.startedBy === "retry" ? <span>Retry of r-0988</span> : null}
        <RetryButton
          retry={view.retry}
          latestVersion={run.latestVersion}
          showWhy={false}
          className="ml-auto"
        />
      </div>
      {view.retry.allowed || view.retry.hide === true ? null : (
        <p className="-mt-3 text-right text-xs text-muted-foreground">{view.retry.why}</p>
      )}
      {run.error === undefined ? null : <ErrorNote error={run.error} />}
      <div className="h-[600px]" ref={frame}>
        <RunGraph spec={run.spec} trace={view.trace} fill className="rounded-xl border">
          {step === undefined ? null : (
            <StepPanel
              step={step}
              view={view}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
        </RunGraph>
      </div>
      <ol aria-label="Steps in order" className="flex flex-wrap gap-2">
        {run.steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={s.id === selected}
              onClick={() => {
                setSelected(s.id);
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs",
                s.id === selected ? "border-foreground" : "hover:bg-muted",
              )}
            >
              <StatusMark status={s.status} className="size-5" />
              {s.id}
            </button>
          </li>
        ))}
      </ol>
      <ReviewsLine view={view} />
    </PrototypeMain>
  );
}

function StepPanel({ step, view, onClose }: { step: RunStep; view: RunView; onClose: () => void }) {
  return (
    <aside
      aria-label={`Step ${step.id}`}
      className="absolute top-3 right-3 bottom-3 z-10 flex w-96 flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <StatusMark status={step.status} />
        <div className="flex flex-1 flex-col">
          <span className="font-medium">{step.does}</span>
          <code className="text-xs text-muted-foreground">
            {step.id}, {step.type}
            {step.path === undefined ? "" : `, ${step.path} path`}
          </code>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-sm font-medium">{STEP_STATUS_WORDS[step.status]}</p>
      <StepMeta step={step} />
      {step.error === undefined ? null : <ErrorNote error={step.error} />}
      {step.checks === undefined ? null : <CheckList checks={step.checks} />}
      {step.paths === undefined ? null : (
        <ul className="text-sm">
          {step.paths.map((p) => (
            <li key={p.id}>
              {p.taken ? "Took" : "Skipped"} {p.name}
              {p.taken && view.full ? `: ${p.why}` : ""}
            </li>
          ))}
        </ul>
      )}
      <StepOutput step={step} full={view.full} />
      {step.status === "not_reached" ? (
        <p className="text-sm text-muted-foreground">The run stopped before this step.</p>
      ) : null}
    </aside>
  );
}

function ReviewsLine({ view }: { view: RunView }) {
  const { reviews } = view.run;
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">This run created no reviews.</p>;
  }
  return (
    <p className="text-sm">
      Created{" "}
      {reviews.map((r) =>
        view.full ? (
          <Link key={r.id} href="/prototype/review-cards" className="underline">
            {r.title}
          </Link>
        ) : (
          <span key={r.id}>a review for {view.owner.name}</span>
        ),
      )}
      , {reviews[0].state.toLowerCase()}.
    </p>
  );
}
