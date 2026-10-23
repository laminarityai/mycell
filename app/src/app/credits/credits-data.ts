// What the Credits page reads, apart from rendering it, so a test can pin its query budget: the
// same queries for 1 workflow as for 20 (src/app/tests/credits-page.test.ts). Workflow names
// and budgets are joined here, since credits can't import workflows.
import { getRunway, getSpendingSummary, listLedger } from "@/features/credits/server";
import {
  monthRange,
  type LedgerLine,
  type Runway,
  type SpendingSummary,
  type WorkflowSpendingLine,
} from "@/features/credits/types";
import { listWorkflowBudgets } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";

/** How many of the latest ledger entries the page lists. */
const LATEST_ENTRIES = 25;

export type CreditsPage = {
  now: Date;
  runway: Runway;
  summary: SpendingSummary;
  /** Most spent first, then any other workflow with a budget. */
  workflows: WorkflowSpendingLine[];
  entries: LedgerLine[];
};

/** This month's spending, the runway and the latest entries; admins only. */
export async function loadCreditsPage(ctx: Ctx, now: Date): Promise<CreditsPage> {
  const [runway, summary, entries, budgets] = await Promise.all([
    getRunway(ctx),
    getSpendingSummary(ctx, monthRange(now)),
    listLedger(ctx, { limit: LATEST_ENTRIES }),
    listWorkflowBudgets(ctx),
  ]);
  const byId = new Map(budgets.map((budget) => [budget.id, budget]));
  const spending = summary.byWorkflow.map((line): WorkflowSpendingLine => {
    const budget = byId.get(line.workflowId);
    const monthlyBudget = budget?.monthlyCredits ?? null;
    return {
      ...line,
      // Usage outlives what it was for; a workflow the org no longer has is still spending.
      name: budget?.name ?? "Unknown workflow",
      monthlyBudget,
      budgetReached: monthlyBudget !== null && line.spent >= monthlyBudget,
    };
  });
  const spent = new Set(spending.map((line) => line.workflowId));
  const idle = budgets
    .filter((budget) => !budget.archived && budget.monthlyCredits !== null && !spent.has(budget.id))
    .map((budget): WorkflowSpendingLine => ({
      workflowId: budget.id,
      name: budget.name,
      monthlyBudget: budget.monthlyCredits,
      spent: 0,
      daily: summary.days.map(() => 0),
      budgetReached: false,
    }));
  return {
    now,
    runway,
    summary,
    workflows: [...spending, ...idle],
    entries: entries.map((entry) => ({
      ...entry,
      workflowName: entry.workflowId === null ? null : (byId.get(entry.workflowId)?.name ?? null),
    })),
  };
}
