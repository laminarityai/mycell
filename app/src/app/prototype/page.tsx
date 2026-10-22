// PROTOTYPE, throwaway: the index of every v1 prototype route, its variants, and the verdict
// each round reached.
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { PrototypeHeader, PrototypeMain } from "./_shared/header";

type Route = {
  route: string;
  milestone: string;
  what: string;
  variants: string[];
  verdict: string;
};

const ROUTES: Route[] = [
  {
    route: "shell",
    milestone: "M7–M9",
    what: "Navigation with Ask Mycel, Runs, Alerts and Credits; the out-of-credits banner",
    variants: ["A", "B", "C"],
    verdict: "B, the grouped sidebar. Round 2 pages sit in it.",
  },
  {
    route: "credits",
    milestone: "M7",
    what: "Credits page: balance, runway, spending by group and workflow, ledger",
    variants: ["E2", "D", "E", "A", "B", "C"],
    verdict: "E, one chart with lenses, plus a date range selector (E2).",
  },
  {
    route: "workflow-status",
    milestone: "M7 + M8",
    what: "A workflow page's status: spent of budget, paused: failing, resume",
    variants: ["A", "B", "C"],
    verdict: "C, the Health tab.",
  },
  {
    route: "paused-states",
    milestone: "M7 + M8",
    what: "Members' Workflows list with every pause reason",
    variants: ["A2", "A", "B", "C"],
    verdict: "A, with app icons (A2).",
  },
  {
    route: "runs",
    milestone: "M8",
    what: "Runs across workflows, filtered and paged",
    variants: ["A", "B", "C"],
    verdict: "A, the dense table.",
  },
  {
    route: "run",
    milestone: "M8",
    what: "One run: steps, path on the graph, reviews, retry",
    variants: ["A", "B", "C"],
    verdict: "B, graph first.",
  },
  {
    route: "alerts",
    milestone: "M8",
    what: "Alerts page and count",
    variants: ["D", "E", "A", "B", "C"],
    verdict: "D, a sidebar tab with a full-width table grouped by urgency.",
  },
  {
    route: "ask",
    milestone: "M9",
    what: "Ask Mycel: the agent chat",
    variants: ["A2", "A", "B", "C"],
    verdict: "A, with chat search and a better New button (A2).",
  },
  {
    route: "told-facts",
    milestone: "M9",
    what: "What I've told Mycel",
    variants: ["B2", "A", "B", "C"],
    verdict: "B, without the Everything/People/Companies selector (B2).",
  },
  {
    route: "review-cards",
    milestone: "M11",
    what: "Calendar and Docs reviews beside Gmail drafts",
    variants: ["A", "B", "C"],
    verdict: "B, kind-specific previews.",
  },
];

export default function PrototypeIndex() {
  if (env.NODE_ENV === "production") notFound();
  return (
    <PrototypeMain>
      <PrototypeHeader title="v1 prototypes" admin />
      <p className="text-sm text-muted-foreground">
        Flip variants with the bar at the bottom or the ← → keys; some add toggles such as{" "}
        <code>as=member</code>. Round 2 variants come first and sit in the chosen sidebar.
      </p>
      <ul className="flex flex-col divide-y rounded-md border">
        {ROUTES.map(({ route, milestone, what, variants, verdict }) => (
          <li key={route} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
            <Link href={`/prototype/${route}`} className="font-medium underline">
              /prototype/{route}
            </Link>
            <span className="text-xs text-muted-foreground">{milestone}</span>
            <span className="w-full text-sm">{what}</span>
            <span className="w-full text-sm">
              <span className="font-medium">Verdict:</span> {verdict}
            </span>
            <span className="flex gap-2 text-xs">
              {variants.map((v) => (
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
