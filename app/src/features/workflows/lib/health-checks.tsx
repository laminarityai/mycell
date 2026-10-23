// The workflow page's Health tab (M7): each thing that can stop the workflow, as a check that
// passes or says what stopped it and what lifts it. The company's credits, then its budget; M8
// adds its runs' failures.
import { CircleCheck, CirclePause, CircleX } from "lucide-react";
import type { ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import type { WorkflowHealth } from "../types";
import { BUDGET_HELP } from "./budget-help";
import { pausedText } from "./paused-text";
import { ChangeBudgetButton } from "./workflow-tabs";

type Verdict = "ok" | "stopped" | "waiting";

const ICON: Record<Verdict, ReactNode> = {
  ok: <CircleCheck className="size-5 text-emerald-600" aria-label="OK" role="img" />,
  stopped: <CircleX className="size-5 text-destructive" aria-label="Stopped" role="img" />,
  // Reached, but something earlier in the order stops it first.
  waiting: <CirclePause className="size-5 text-muted-foreground" aria-label="Also" role="img" />,
};

const credits = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function WorkflowHealthChecks({ health }: { health: WorkflowHealth }) {
  const outOfCredits = health.balance <= 0;
  const reached = health.pauses.includes("budget_reached");
  const { spentThisMonth: spent, monthlyBudget: budget } = health;
  return (
    <section aria-label="Health" className="flex max-w-3xl flex-col gap-4">
      <Summary health={health} />
      <ul className="flex flex-col divide-y rounded-lg border">
        <Check
          verdict={outOfCredits ? "stopped" : "ok"}
          title={outOfCredits ? "The company is out of credits" : "The company has credits"}
        >
          {outOfCredits ? (
            <p>
              Every workflow is paused. This one starts again by itself as soon as the Mycel team
              grants more credits; messages that arrive meanwhile aren&apos;t run later.
            </p>
          ) : (
            <p>{credits.format(health.balance)} credits left for the whole company.</p>
          )}
        </Check>
        <Check
          verdict={reached ? (outOfCredits ? "waiting" : "stopped") : "ok"}
          title={
            budget === null
              ? `Spent ${credits.format(spent)} credits this month, with no budget`
              : `Spent ${credits.format(spent)} of ${credits.format(budget)} credits this month`
          }
        >
          {reached ? (
            <p className="text-foreground">
              Budget reached. It starts again on <DateTime value={health.nextMonth} day />, or as
              soon as you publish a higher budget or none.
            </p>
          ) : null}
          {BUDGET_HELP.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <ChangeBudgetButton />
        </Check>
      </ul>
    </section>
  );
}

// Whether it runs, in a line: what stops it first, or why it doesn't run at all.
function Summary({ health }: { health: WorkflowHealth }) {
  const first = health.pauses.at(0);
  if (first !== undefined) {
    return (
      <p className="text-base">
        <span className="font-semibold">Paused: {pausedText(first, null)}.</span>{" "}
        <span className="text-muted-foreground">
          It starts again by itself once what stops it below is cleared.
        </span>
      </p>
    );
  }
  const line = {
    not_published: "Not published yet, so it doesn't run.",
    archived: "Archived, so it doesn't run.",
    running: "Running. Nothing stops it.",
    paused: "Running. Nothing stops it.",
  }[health.status];
  return <p className="text-base">{line}</p>;
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
