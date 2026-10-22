// PROTOTYPE, throwaway: the context variant E shows inside each alert's band, worked out from the
// shared fixtures: a failing workflow's three failed runs, the balance and runway for credits,
// the spend against a budget, and which inbox a connection alert is about. When each started
// shows in the band itself.
import Link from "next/link";
import type { ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import { CONNECTIONS, CREDITS, NOW, RUNS, WORKFLOWS } from "../_shared/fixtures";
import { ago, type Alert } from "./alert-data";
import { aboutOf } from "./alert-urgency";

const NUMBER = new Intl.NumberFormat("en-US");
const DAY_MS = 24 * 60 * 60_000;

type Fact = { label: string; value: ReactNode };

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-3">
      {facts.map((f) => (
        <div key={f.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className="text-sm font-medium">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AlertContext({ alert: a }: { alert: Alert }) {
  switch (a.kind) {
    case "workflow_failing":
      return <FailedRuns alert={a} />;
    case "credits_out":
      return (
        <Facts
          facts={[
            { label: "Balance", value: "0 credits" },
            { label: "Paused", value: `All ${String(WORKFLOWS.length)} workflows` },
            { label: "Also stopped", value: "Ask Mycel and the builder chat" },
          ]}
        />
      );
    case "credits_low":
      return (
        <Facts
          facts={[
            { label: "Balance", value: `${NUMBER.format(CREDITS.balance)} credits` },
            {
              label: "This week's rate",
              value: `${NUMBER.format(CREDITS.dailyAverage7d)} a day`,
            },
            {
              label: "Runs out around",
              value: <DateTime value={new Date(NOW.getTime() + 5 * DAY_MS)} day />,
            },
            { label: "Alerts under", value: `${String(CREDITS.lowThresholdDays)} days left` },
          ]}
        />
      );
    case "budget_reached":
      return <BudgetMeter alert={a} />;
    case "connection_reconnect":
    case "backfill_failed":
      return <InboxFacts alert={a} />;
  }
}

function FailedRuns({ alert: a }: { alert: Alert }) {
  const workflow = WORKFLOWS.find((w) => w.name === a.subject);
  const runs = RUNS.filter((r) => workflow?.pausedByRunIds?.includes(r.id));
  const error = runs.find((r) => r.errorText !== undefined)?.errorText;
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid gap-2 sm:grid-cols-3" aria-label="The three failed runs">
        {runs.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-0.5 rounded-md border bg-background px-3 py-2"
          >
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <Link href="/prototype/run" className="font-medium underline underline-offset-4">
                Run {r.id.replace("r-", "")}
              </Link>
              <span className="text-xs text-muted-foreground">{ago(r.startedAt)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {r.status === "failed" ? "Failed" : "Partly failed"} at {r.failedStep}
            </span>
          </li>
        ))}
      </ol>
      {error === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          All three: {error}{" "}
          <Link href="/prototype/runs" className="underline underline-offset-4">
            See its runs
          </Link>
        </p>
      )}
    </div>
  );
}

function BudgetMeter({ alert: a }: { alert: Alert }) {
  const workflow = WORKFLOWS.find((w) => w.name === a.subject);
  if (workflow?.budget === undefined || workflow.budget === null) return null;
  const share = Math.min(100, Math.round((workflow.spentThisMonth / workflow.budget) * 100));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-md flex-col gap-1.5">
        <span className="flex justify-between text-xs text-muted-foreground">
          <span>Spent this month</span>
          <span>
            {NUMBER.format(workflow.spentThisMonth)} of {NUMBER.format(workflow.budget)} credits
          </span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className="block h-full rounded-full bg-amber-500"
            style={{ width: `${String(share)}%` }}
          />
        </span>
      </div>
      <Facts
        facts={[{ label: "Budget resets", value: <DateTime value={new Date("2026-11-01")} day /> }]}
      />
    </div>
  );
}

function InboxFacts({ alert: a }: { alert: Alert }) {
  const { name, note } = aboutOf(a);
  const connection = CONNECTIONS.find((c) => c.label === name);
  const shared = connection?.kind === "org";
  const workflows = WORKFLOWS.filter((w) => w.credentials === (shared ? "org" : "member"));
  const onIt = shared ? workflows.filter((w) => w.id === "wf-invoices") : workflows;
  return (
    <Facts
      facts={[
        { label: note, value: name },
        {
          label: a.kind === "backfill_failed" ? "New mail" : "Workflows that can't run on it",
          value:
            a.kind === "backfill_failed"
              ? "Still read as it arrives"
              : onIt.map((w) => w.name).join(", "),
        },
      ]}
    />
  );
}
