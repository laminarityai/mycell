// What the Credits page reads, apart from rendering it, so a test can pin its query budget: the
// same queries for 1 workflow as for 20, and for 12 months as for one
// (src/app/tests/credits-page.test.ts). Workflow names and budgets are joined here, since
// credits can't import workflows. Whether a workflow is paused, budget reached, is the pause's
// own rule (`budgetsReached`), so the page and the fan-out agree; a past month's days that
// reached it come from the range's daily sums.
import { resolveRange, workflowLine } from "@/features/credits/range";
import {
  budgetsReached,
  getLedgerStart,
  getRunway,
  getSpendingSummary,
  listLedger,
} from "@/features/credits/server";
import type {
  ChosenRange,
  LedgerLine,
  RangeChoice,
  Runway,
  SpendingSummary,
  WorkflowSpendingLine,
} from "@/features/credits/types";
import type { WorkflowBudget } from "@/features/workflows/types";
import { listWorkflowBudgets } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";

/** How many of the range's entries the page lists, newest first. */
const ENTRIES_SHOWN = 25;

export type CreditsPage = {
  now: Date;
  /** The range the page shows: the one asked for, kept inside the org's history. */
  chosen: ChosenRange;
  /** Now, whatever the range. */
  runway: Runway;
  summary: SpendingSummary;
  /** Most spent first, then any other workflow with a budget. */
  workflows: WorkflowSpendingLine[];
  /** The range's newest entries. */
  entries: LedgerLine[];
  /** The range has more entries than these. */
  moreEntries: boolean;
};

/**
 * The range's spending and entries, with the balance and runway now; this month by default.
 * Admins only.
 */
export async function loadCreditsPage(
  ctx: Ctx,
  now: Date,
  choice: RangeChoice = { preset: "this_month" },
): Promise<CreditsPage> {
  // The range needs the org's first entry; the runway and budgets don't wait for it. Which
  // budgets are reached is this month's, asked whatever the range so the queries don't vary.
  const inRange = getLedgerStart(ctx).then(async (start) => {
    const chosen = resolveRange(choice, now, start);
    const [summary, entries] = await Promise.all([
      getSpendingSummary(ctx, chosen.range),
      listLedger(ctx, { range: chosen.range, limit: ENTRIES_SHOWN + 1 }),
    ]);
    return { chosen, summary, entries };
  });
  const [runway, { budgets, reached }, { chosen, summary, entries }] = await Promise.all([
    getRunway(ctx),
    listWorkflowBudgets(ctx).then(withReached(ctx)),
    inRange,
  ]);
  const byId = new Map(budgets.map((budget) => [budget.id, budget]));
  const spending = summary.byWorkflow.map((line) => {
    const budget = byId.get(line.workflowId);
    return workflowLine(
      summary,
      line,
      // Usage outlives what it was for; a workflow the org no longer has is still spending.
      { name: budget?.name ?? "Unknown workflow", monthlyBudget: budget?.monthlyCredits ?? null },
      reached.has(line.workflowId),
      now,
    );
  });
  const spent = new Set(spending.map((line) => line.workflowId));
  const idle = budgets
    .filter((budget) => !budget.archived && budget.monthlyCredits !== null && !spent.has(budget.id))
    .map((budget) =>
      workflowLine(
        summary,
        { workflowId: budget.id, spent: 0, daily: summary.days.map(() => 0), monthBefore: 0 },
        { name: budget.name, monthlyBudget: budget.monthlyCredits },
        reached.has(budget.id),
        now,
      ),
    );
  return {
    now,
    chosen,
    runway,
    summary,
    workflows: [...spending, ...idle],
    entries: entries.slice(0, ENTRIES_SHOWN).map((entry) => ({
      ...entry,
      workflowName: entry.workflowId === null ? null : (byId.get(entry.workflowId)?.name ?? null),
    })),
    moreEntries: entries.length > ENTRIES_SHOWN,
  };
}

/** The budgets, and which of their workflows have reached theirs this month. */
function withReached(ctx: Ctx) {
  return async (budgets: WorkflowBudget[]) => {
    const monthly = new Map(
      budgets.flatMap((budget) =>
        budget.monthlyCredits === null ? [] : [[budget.id, budget.monthlyCredits] as const],
      ),
    );
    return { budgets, reached: await budgetsReached(ctx, monthly) };
  };
}
