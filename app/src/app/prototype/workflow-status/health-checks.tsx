"use client";

// PROTOTYPE, throwaway: variant C's Health tab: the three things that can stop a workflow
// (credits, failures, its budget), each as a check that passes or explains what stopped it.
import Link from "next/link";
import { CircleCheck, CirclePause, CircleX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { ago, fmt } from "../credits/format";
import { BudgetField } from "./budget-field";
import { FAILED_RUNS, NEXT_MONTH, PAUSED_SINCE, RUNS_HREF, runHref } from "./fixtures";
import { PAUSE_LABEL, type WorkflowStatus } from "./use-workflow-status";

type Verdict = "ok" | "warn" | "stopped" | "waiting";

const ICON: Record<Verdict, ReactNode> = {
  ok: <CircleCheck className="size-5 text-emerald-600" aria-label="OK" />,
  warn: <TriangleAlert className="size-5 text-amber-500" aria-label="Close" />,
  stopped: <CircleX className="size-5 text-destructive" aria-label="Stopped" />,
  waiting: <CirclePause className="size-5 text-muted-foreground" aria-label="Paused" />,
};

export function HealthChecks({ status }: { status: WorkflowStatus }) {
  const { effective, spent, budget, balance } = status;
  const outOfCredits = balance <= 0;
  const near = budget !== null && !status.reached && spent / budget >= 0.7;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg">
        {effective === "running" ? (
          "Running. Nothing is stopping it."
        ) : (
          <>
            <span className="font-semibold">{PAUSE_LABEL[effective]}.</span>{" "}
            <span className="text-muted-foreground">
              {effective === "failures"
                ? "Only you can resume it."
                : "It resumes by itself once the cause below is cleared."}
            </span>
          </>
        )}
      </p>
      {status.notice ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{status.notice}</p>
      ) : null}
      <ul className="flex flex-col divide-y rounded-lg border">
        <Check
          verdict={outOfCredits ? "stopped" : "ok"}
          title={outOfCredits ? "The company is out of credits" : "The company has credits"}
        >
          {outOfCredits ? (
            <p>
              Since {ago(PAUSED_SINCE.out_of_credits)}, every workflow is paused. This one resumes
              by itself as soon as the Mycel team grants more; mail that arrives meanwhile
              isn&rsquo;t run later.{" "}
              <Link href="/prototype/credits" className="underline">
                Open Credits
              </Link>
            </p>
          ) : (
            <p>
              {fmt(balance)} credits left for the whole company.{" "}
              <Link href="/prototype/credits" className="underline">
                Open Credits
              </Link>
            </p>
          )}
        </Check>
        <Check
          verdict={status.pausedForFailures ? "stopped" : "ok"}
          title={
            status.pausedForFailures ? "Three runs in a row failed" : "Its runs aren't failing"
          }
        >
          {status.pausedForFailures ? (
            <FailureDetail status={status} />
          ) : (
            <p>
              Three failed runs in a row would pause it until you resume it. Failures from one
              person&rsquo;s connection and out-of-credits failures don&rsquo;t count.{" "}
              <Link href={RUNS_HREF} className="underline">
                See its runs
              </Link>
            </p>
          )}
        </Check>
        <Check
          verdict={
            status.reached
              ? outOfCredits || status.pausedForFailures
                ? "waiting"
                : "stopped"
              : near
                ? "warn"
                : "ok"
          }
          title={
            budget === null
              ? `Spent ${fmt(spent)} credits this month, no budget`
              : `Spent ${fmt(spent)} of ${fmt(budget)} credits this month`
          }
        >
          {status.reached ? (
            <p>
              Budget reached. It resumes on <DateTime value={NEXT_MONTH} day />, or at once if you
              raise or remove the budget.
            </p>
          ) : null}
          <BudgetField status={status} id="budget-c" />
        </Check>
      </ul>
    </div>
  );
}

function Check({
  verdict,
  title,
  children,
}: {
  verdict: Verdict;
  title: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-4",
        verdict === "stopped" && "bg-destructive/5",
      )}
    >
      <span className="pt-0.5">{ICON[verdict]}</span>
      <span className="font-medium">{title}</span>
      <div className="col-start-2 flex flex-col gap-3 text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  );
}

function FailureDetail({ status }: { status: WorkflowStatus }) {
  return (
    <>
      <p>
        Paused {ago(PAUSED_SINCE.failures)}. It stays paused until you resume it, even if you
        publish a fix. Members see &ldquo;Paused: failing, an admin will look at it&rdquo;.
      </p>
      <table className="w-full text-left text-foreground">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Run</th>
            <th className="py-1 font-normal">Inbox</th>
            <th className="py-1 font-normal">Failed at</th>
          </tr>
        </thead>
        <tbody>
          {FAILED_RUNS.map((run) => (
            <tr key={run.id} className="border-t align-top">
              <td className="py-2 pr-3">
                <Link href={runHref(run.id)} className="underline">
                  <DateTime value={run.at} />
                </Link>
              </td>
              <td className="py-2 pr-3">{run.inbox}</td>
              <td className="py-2">
                <span className="font-mono text-xs">{run.step}</span>
                <span className="block text-xs text-muted-foreground">{run.error}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            status.resume();
          }}
        >
          Resume
        </Button>
        <span className="text-xs">Its count of failed runs starts again from zero.</span>
      </div>
    </>
  );
}
