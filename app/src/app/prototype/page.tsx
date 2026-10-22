// PROTOTYPE, throwaway: the index of every v1 prototype route and its variants.
import Link from "next/link";
import { PrototypeHeader, PrototypeMain } from "./_shared/header";

const ROUTES = [
  [
    "shell",
    "M7–M9",
    "Navigation with Ask Mycel, Runs, Alerts and Credits; the out-of-credits banner",
  ],
  ["credits", "M7", "Credits page: balance, runway, spending by group and workflow, ledger"],
  [
    "workflow-status",
    "M7 + M8",
    "A workflow page's status: spent of budget, paused: failing, resume",
  ],
  ["paused-states", "M7 + M8", "Members' Workflows list with every pause reason"],
  ["runs", "M8", "Runs across workflows, filtered and paged"],
  ["run", "M8", "One run: steps, path on the graph, reviews, retry"],
  ["alerts", "M8", "Alerts page and count"],
  ["ask", "M9", "Ask Mycel: the agent chat"],
  ["told-facts", "M9", "What I've told Mycel"],
  ["review-cards", "M11", "Calendar and Docs reviews beside Gmail drafts"],
] as const;

export default function PrototypeIndex() {
  return (
    <PrototypeMain>
      <PrototypeHeader title="v1 prototypes" admin />
      <p className="text-sm text-muted-foreground">
        Each route has variants A, B and C. Flip with the bar at the bottom or the ← → keys; some
        add toggles such as <code>as=member</code>.
      </p>
      <ul className="flex flex-col divide-y rounded-md border">
        {ROUTES.map(([route, milestone, what]) => (
          <li key={route} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
            <Link href={`/prototype/${route}`} className="font-medium underline">
              /prototype/{route}
            </Link>
            <span className="text-xs text-muted-foreground">{milestone}</span>
            <span className="w-full text-sm">{what}</span>
            <span className="flex gap-2 text-xs">
              {["A", "B", "C"].map((v) => (
                <Link key={v} href={`/prototype/${route}?variant=${v}`} className="underline">
                  {v}
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </PrototypeMain>
  );
}
