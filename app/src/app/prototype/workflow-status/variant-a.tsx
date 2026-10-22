"use client";

// PROTOTYPE, throwaway: variant A, a banner across the top when the workflow is paused, and one
// spent line under the title. The budget field stays in the editor's settings, where it's edited.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago, fmt } from "../credits/format";
import { BudgetField } from "./budget-field";
import { EditorPlaceholder, SwitchPlaceholder } from "./editor-mock";
import { FAILED_RUNS, NEXT_MONTH, PAUSED_SINCE, RUNS_HREF, WORKFLOW, runHref } from "./fixtures";
import { PAUSE_LABEL, useWorkflowStatus, type WorkflowStatus } from "./use-workflow-status";

export function VariantA({ params }: VariantProps) {
  return <Page key={params.state} state={params.state} />;
}

function Page({ state }: { state: string }) {
  const status = useWorkflowStatus(state);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Workflow" admin />
      <Banner status={status} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{WORKFLOW.name}</h2>
          <Badge variant="outline">Version {WORKFLOW.version}</Badge>
          {status.effective === "running" ? (
            <Badge variant="secondary">Running</Badge>
          ) : (
            <Badge variant="destructive">{PAUSE_LABEL[status.effective]}</Badge>
          )}
        </div>
        <SpentLine status={status} />
        {status.notice ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{status.notice}</p>
        ) : null}
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
        <EditorPlaceholder
          failedStep={status.effective === "failures" ? "draft-reply" : undefined}
        />
        <section aria-label="Settings" className="flex flex-col gap-4 rounded-lg border p-4">
          <h3 className="text-base font-semibold">Settings</h3>
          <MockField label="Credentials" value="Each admin's own Google connection" />
          <MockField label="Trigger" value="New mail labelled Quotes" />
          <MockField label="Rung" value="3: triggered draft for review" />
          <BudgetField status={status} id="budget-a" />
        </section>
      </div>
      <SwitchPlaceholder />
    </PrototypeMain>
  );
}

function SpentLine({ status }: { status: WorkflowStatus }) {
  const { spent, budget } = status;
  const share = budget === null ? 0 : Math.min(1, spent / budget);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {budget === null ? (
        <span>
          Spent <span className="font-medium text-foreground tabular-nums">{fmt(spent)}</span>{" "}
          credits this month, no budget.
        </span>
      ) : (
        <>
          <span className="inline-block h-1.5 w-24 rounded-full bg-muted" aria-hidden>
            <span
              className={cn(
                "block h-full rounded-full",
                status.reached ? "bg-destructive" : "bg-foreground",
              )}
              style={{ width: `${String(share * 100)}%` }}
            />
          </span>
          <span>
            Spent <span className="font-medium text-foreground tabular-nums">{fmt(spent)}</span> of{" "}
            {fmt(budget)} credits this month
            {status.reached ? ", budget reached." : `, ${fmt(budget - spent)} left.`}
          </span>
        </>
      )}
      <Link href={RUNS_HREF} className="underline">
        See its runs
      </Link>
    </p>
  );
}

function Banner({ status }: { status: WorkflowStatus }) {
  if (status.effective === "running") return null;
  const tone = "flex flex-col gap-3 rounded-lg border-l-4 p-4 text-sm";
  if (status.effective === "out_of_credits") {
    return (
      <section role="status" className={cn(tone, "border-destructive bg-destructive/5")}>
        <p className="font-semibold">Paused: out of credits, {ago(PAUSED_SINCE.out_of_credits)}</p>
        <p className="max-w-prose">
          The company has no credits left, so no workflow starts new runs. This one resumes by
          itself as soon as the Mycel team grants more. Mail that arrives meanwhile isn&rsquo;t run
          later. Members see &ldquo;Paused: out of credits&rdquo;.
        </p>
        <Link href="/prototype/credits" className="w-fit font-medium underline">
          Open Credits
        </Link>
      </section>
    );
  }
  if (status.effective === "budget_reached") {
    return (
      <section role="status" className={cn(tone, "border-amber-500 bg-amber-500/5")}>
        <p className="font-semibold">Paused: budget reached, {ago(PAUSED_SINCE.budget_reached)}</p>
        <p className="max-w-prose">
          It has spent {fmt(status.spent)} of its {fmt(status.budget ?? 0)} credits this month. It
          resumes on <DateTime value={NEXT_MONTH} day />, or at once if you raise or remove the
          budget. Members see &ldquo;Paused: budget reached&rdquo;.
        </p>
        <a href="#budget-a" className="w-fit font-medium underline">
          Change the budget
        </a>
      </section>
    );
  }
  return (
    <section role="status" className={cn(tone, "border-destructive bg-destructive/5")}>
      <p className="font-semibold">Paused: failing, {ago(PAUSED_SINCE.failures)}</p>
      <p className="max-w-prose">
        Three runs in a row failed, so it stopped to save credits and spare people. It stays paused
        until you resume it, even if you publish a fix. Members see &ldquo;Paused: failing, an admin
        will look at it&rdquo;.
      </p>
      <ol className="flex flex-col gap-1">
        {FAILED_RUNS.map((run) => (
          <li key={run.id}>
            <Link href={runHref(run.id)} className="underline">
              <DateTime value={run.at} />
            </Link>{" "}
            on {run.inbox}: <span className="font-mono text-xs">{run.step}</span> failed.{" "}
            {run.error}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            status.resume();
          }}
        >
          Resume
        </Button>
        <span className="text-xs text-muted-foreground">
          Its count of failed runs starts again from zero.
        </span>
      </div>
      {status.reached ? (
        <p className="text-xs">
          Its budget is also reached, so it stays paused for that after you resume.
        </p>
      ) : null}
    </section>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <span className="rounded-md border px-3 py-1.5 text-muted-foreground">{value}</span>
    </div>
  );
}
