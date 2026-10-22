// Review counts as the Workflows page lists them: a row per workflow, and for admins each
// person's under it. The periods the page offers are counted back from now here.
import type { Ctx } from "@/lib/ctx";
import type { ReviewCountsRow, ReviewPeriod, ReviewStatsQuery } from "../types";
import { reviewStatsByWorkflow } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = { "2d": 2, "7d": 7, "30d": 30 } as const;

/**
 * Each workflow's review counts over `period`: an admin's (and the system ctx's) every review,
 * with each person's under it (the shared inbox's last); a member's own reviews only.
 */
export async function reviewCountsByWorkflow(
  ctx: Ctx,
  workflows: readonly { id: string; name: string }[],
  period: ReviewPeriod,
  now: Date = new Date(),
): Promise<ReviewCountsRow[]> {
  const since = sinceOf(period, now);
  const perPerson = ctx.role === "admin" || ctx.role === "system";
  // Every workflow counted together: the page makes the same queries for 1 workflow or 100.
  const byWorkflow = await reviewStatsByWorkflow(
    ctx,
    workflows.map((workflow) => workflow.id),
    { since, ...(perPerson ? { groupBy: "user" as const } : {}) },
  );
  return workflows.flatMap((workflow) => {
    const stats = byWorkflow.get(workflow.id);
    if (stats === undefined) return [];
    return [
      { key: workflow.id, label: workflow.name, tally: stats },
      ...stats.byUser.map((row) => ({
        key: `${workflow.id}-${row.user?.id ?? "shared"}`,
        label: row.user?.name ?? "Shared inbox",
        person: true,
        tally: row,
      })),
    ];
  });
}

/** Where `period` starts, as `reviewStats` takes it, counting back from `now`. */
function sinceOf(period: ReviewPeriod, now: Date): ReviewStatsQuery["since"] {
  if (period === "current_version") return period;
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}
