"use client";

// A run on the graph of the version it ran: the steps it reached and the paths it took lit up as
// Try it lights them, its steps in order under it, and the selected step's details in a panel
// over the graph's edge. The step it failed at opens first.
import { Lock, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { eachStep } from "@/features/spec/tree";
import type { Spec } from "@/features/spec/types";
import { WorkflowGraph, type GraphSelection } from "@/features/workflows/ui";
import { cn } from "@/lib/utils";
import type { RunRecord, RunStepCheck, RunStepRecord } from "../types";
import { FailureNote } from "./failure-note";
import { creditsText, inboxLabel } from "./runs-table";

const STEP_STATUS: Record<RunStepRecord["status"], string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  check_failed: "Check failed",
  skipped: "Skipped",
};

const CHECK_NAMES: Record<RunStepCheck["check"], string> = {
  schema: "Schema",
  minP: "Confidence",
  requiredFields: "Required fields",
};

const CHECK_STATUS: Record<RunStepCheck["status"], string> = {
  passed: "passed",
  failed: "failed",
  not_checked: "not checked",
};

const failed = (step: RunStepRecord) => step.status === "failed" || step.status === "check_failed";

export function RunGraph({ run }: { run: RunRecord }) {
  const spec = run.version?.spec ?? null;
  const [selected, setSelected] = useState<string | null>(
    (run.steps.find(failed) ?? run.steps.at(-1))?.stepId ?? null,
  );
  // A path's box selects the branch it leaves from.
  const branchOf = useMemo(() => pathBranches(spec), [spec]);
  const selecting = useMemo(
    () => ({
      selected: selected === null ? null : `step:${selected}`,
      onSelect: (selection: GraphSelection) => {
        if (selection.kind === "step") setSelected(selection.id);
        if (selection.kind === "path") setSelected(branchOf.get(selection.id) ?? null);
      },
    }),
    [selected, branchOf],
  );
  const step = run.steps.find((each) => each.stepId === selected);
  return (
    <div className="flex flex-col gap-3">
      <div className="h-[560px]">
        <WorkflowGraph
          spec={spec}
          trace={run.trace}
          traceCaption="Lit steps ran, faded ones didn't. Click a step for its details."
          selecting={selecting}
          fill
          className="overflow-hidden rounded-lg border"
        >
          {selected === null ? null : (
            <StepPanel
              stepId={selected}
              step={step}
              run={run}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
        </WorkflowGraph>
      </div>
      <ol aria-label="Steps in order" className="flex flex-wrap gap-2">
        {run.steps.map((each) => (
          <li key={each.stepId}>
            <Button
              variant={each.stepId === selected ? "secondary" : "outline"}
              size="sm"
              aria-pressed={each.stepId === selected}
              onClick={() => {
                setSelected(each.stepId);
              }}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  each.status === "succeeded" ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              {each.stepId}
              <span className="sr-only">, {STEP_STATUS[each.status]}</span>
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Each path's ID, to the ID of the branch it leaves from.
function pathBranches(spec: Spec | null): Map<string, string> {
  if (spec === null) return new Map();
  return new Map(
    eachStep(spec).flatMap(({ step }) =>
      step.type === "branch"
        ? [...step.paths.map((path) => path.id), step.otherwise.id].map(
            (pathId) => [pathId, step.id] as const,
          )
        : [],
    ),
  );
}

function StepPanel({
  stepId,
  step,
  run,
  onClose,
}: {
  stepId: string;
  step: RunStepRecord | undefined;
  run: RunRecord;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label={`Step ${stepId}`}
      className="absolute top-3 right-3 bottom-3 z-10 flex w-96 max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-4 text-sm shadow-lg"
    >
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col">
          <code className="font-mono font-medium">{stepId}</code>
          {step === undefined ? null : (
            <span className="text-xs text-muted-foreground">
              {step.type}
              {step.path === null ? "" : `, on ${step.path}`}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {step === undefined ? (
        <p className="text-muted-foreground">The run didn&apos;t reach this step.</p>
      ) : (
        <StepDetails step={step} run={run} />
      )}
    </aside>
  );
}

function StepDetails({ step, run }: { step: RunStepRecord; run: RunRecord }) {
  const seconds = (step.finishedAt.getTime() - step.startedAt.getTime()) / 1000;
  const meta = [
    step.attempts === 1 ? "1 attempt" : `${String(step.attempts)} attempts`,
    step.modelId === null ? null : `${step.modelRole ?? "a"} model, ${step.modelId}`,
    `${creditsText(step.costCredits)} credits`,
    `${seconds.toFixed(1)} s`,
  ].filter((part) => part !== null);
  return (
    <>
      <p className={cn("font-medium", failed(step) && "text-destructive")}>
        {STEP_STATUS[step.status]}
      </p>
      <p className="text-xs text-muted-foreground">
        {meta.join(", ")}. Started <DateTime value={step.startedAt} />.
      </p>
      {failed(step) ? <FailureNote code={step.errorCode} message={step.errorMessage} /> : null}
      {step.checks.length === 0 ? null : (
        <ul aria-label="Checks" className="flex flex-col gap-1">
          {step.checks.map((check) => (
            <li key={check.check}>
              <span
                className={cn(
                  "font-medium",
                  check.status === "failed" && "text-destructive",
                  check.status === "not_checked" && "text-muted-foreground",
                )}
              >
                {CHECK_NAMES[check.check]} check {CHECK_STATUS[check.status]}
              </span>
              {check.reason === null ? null : (
                <span className="block text-xs wrap-anywhere text-muted-foreground">
                  {check.reason}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <StepOutput step={step} run={run} />
    </>
  );
}

/** What the step handed on, as its record keeps it (never content), for the inbox's readers. */
function StepOutput({ step, run }: { step: RunStepRecord; run: RunRecord }) {
  if (!run.full) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock aria-hidden className="size-3 shrink-0" />
        Output hidden: it&apos;s from {inboxLabel(run.inbox)}&apos;s mail
      </p>
    );
  }
  if (step.output === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">What it recorded</p>
      <pre className="overflow-x-auto rounded bg-muted/60 p-2 font-mono text-xs">
        {JSON.stringify(step.output, null, 2)}
      </pre>
    </div>
  );
}
