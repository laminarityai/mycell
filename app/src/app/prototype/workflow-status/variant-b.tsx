"use client";

// PROTOTYPE, throwaway: variant B, a status column of cards to the right of the editor: whether
// it's running, this month against its budget (with the field), the runs that paused it, and
// its runs. Nothing about status sits above or inside the editor.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago, fmt } from "../credits/format";
import { BudgetField } from "./budget-field";
import { EditorPlaceholder, SwitchPlaceholder } from "./editor-mock";
import {
  FAILED_RUNS,
  NEXT_MONTH,
  PAUSED_SINCE,
  RUNS_HREF,
  RUNS_TODAY,
  WORKFLOW,
  runHref,
} from "./fixtures";
import { PAUSE_LABEL, useWorkflowStatus, type WorkflowStatus } from "./use-workflow-status";

export function VariantB({ params }: VariantProps) {
  return <Page key={params.state} state={params.state} />;
}

function Page({ state }: { state: string }) {
  const status = useWorkflowStatus(state);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Workflow" admin />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{WORKFLOW.name}</h2>
            <span className="text-sm text-muted-foreground">Version {WORKFLOW.version}</span>
          </div>
          <EditorPlaceholder
            className="min-h-[28rem]"
            failedStep={status.effective === "failures" ? "draft-reply" : undefined}
          />
          <SwitchPlaceholder />
        </div>
        <aside aria-label="Status" className="flex flex-col gap-4">
          <StatusCard status={status} />
          {status.effective === "failures" ? <FailedRunsCard status={status} /> : null}
          <MonthCard status={status} />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Runs, last 24 hours</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="tabular-nums">
                {RUNS_TODAY.total} runs: {RUNS_TODAY.succeeded} succeeded, {RUNS_TODAY.failed}{" "}
                failed, {RUNS_TODAY.escalated} escalated
              </p>
              <Link href={RUNS_HREF} className="underline">
                See all its runs
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </PrototypeMain>
  );
}

function StatusCard({ status }: { status: WorkflowStatus }) {
  const { effective } = status;
  const paused = effective !== "running";
  return (
    <Card
      size="sm"
      className={cn(
        paused && "ring-destructive/40",
        effective === "budget_reached" && "ring-amber-500/50",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              effective === "running"
                ? "bg-emerald-500"
                : effective === "budget_reached"
                  ? "bg-amber-500"
                  : "bg-destructive",
            )}
          />
          {paused ? PAUSE_LABEL[effective] : "Running"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {effective === "running" ? (
          <p className="text-muted-foreground">
            Starting runs on new mail for everyone it&rsquo;s switched on for.
          </p>
        ) : null}
        {effective === "out_of_credits" ? (
          <>
            <p>
              Since {ago(PAUSED_SINCE.out_of_credits)}. The company has no credits left. It resumes
              by itself when the Mycel team grants more.
            </p>
            <Link href="/prototype/credits" className="underline">
              Open Credits
            </Link>
          </>
        ) : null}
        {effective === "budget_reached" ? (
          <p>
            Since {ago(PAUSED_SINCE.budget_reached)}. Resumes <DateTime value={NEXT_MONTH} day />,
            or at once if you raise or remove its budget below.
          </p>
        ) : null}
        {effective === "failures" ? (
          <>
            <p>
              Since {ago(PAUSED_SINCE.failures)}, after three failed runs in a row. It stays paused
              until you resume it, even after you publish a fix.
            </p>
            <Button
              className="w-fit"
              onClick={() => {
                status.resume();
              }}
            >
              Resume
            </Button>
          </>
        ) : null}
        {status.notice ? (
          <p className="text-emerald-700 dark:text-emerald-400">{status.notice}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FailedRunsCard({ status }: { status: WorkflowStatus }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>The runs that paused it</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y text-sm">
          {FAILED_RUNS.map((run) => (
            <li key={run.id} className="flex flex-col gap-0.5 py-2">
              <Link href={runHref(run.id)} className="font-medium underline">
                <DateTime value={run.at} />
              </Link>
              <span className="text-xs text-muted-foreground">{run.inbox}</span>
              <span>
                <span className="font-mono text-xs">{run.step}</span>: {run.error}
              </span>
            </li>
          ))}
        </ol>
        {status.reached ? (
          <p className="pt-2 text-xs text-muted-foreground">Its budget is also reached.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MonthCard({ status }: { status: WorkflowStatus }) {
  const { spent, budget } = status;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>This month</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold tabular-nums">
            {fmt(spent)}
            <span className="text-base font-normal text-muted-foreground">
              {budget === null ? " credits, no budget" : ` of ${fmt(budget)} credits`}
            </span>
          </p>
          {budget === null ? null : (
            <div className="h-2 rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  status.reached ? "bg-destructive" : "bg-foreground",
                )}
                style={{ width: `${String(Math.min(100, (spent / budget) * 100))}%` }}
              />
            </div>
          )}
          {status.reached ? <Badge variant="destructive">Budget reached</Badge> : null}
        </div>
        <BudgetField status={status} compact id="budget-b" />
      </CardContent>
    </Card>
  );
}
