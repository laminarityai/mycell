// The workflow alerts (#176): a workflow paused for failing, since its pause, until an admin
// resumes it; and one whose live runs reached its monthly budget, from the UTC day they did,
// until the budget is raised or removed or the month ends. Each links to the workflow's page,
// which opens on its Health tab while it's paused, where Resume and the budget are. A workflow
// with both has both.
import { formatCredits } from "@/features/credits/format";
import type { PausedWorkflow } from "@/features/workflows/types";
import type { Alert } from "../types";

export function workflowAlerts(paused: PausedWorkflow[]): Alert[] {
  return paused.flatMap((workflow) => {
    const subject = { type: "workflow" as const, id: workflow.id, name: workflow.name };
    const href = `/workflows/${workflow.id}`;
    const alerts: Alert[] = [];
    if (workflow.failurePause !== null) {
      alerts.push({
        id: `workflow_failing:${workflow.id}`,
        kind: "workflow_failing",
        subject,
        startedAt: workflow.failurePause.pausedAt,
        sentence: `Its last ${String(workflow.failurePause.runIds.length)} runs failed, so Mycel paused it for everyone: no new message starts a run until an admin resumes it.`,
        clearsWhen: "Once an admin resumes it.",
        fix: { label: "Resume", href },
      });
    }
    if (workflow.budgetReached !== null) {
      const { monthlyCredits, reachedOn } = workflow.budgetReached;
      alerts.push({
        id: `budget_reached:${workflow.id}`,
        kind: "budget_reached",
        subject,
        startedAt: reachedOn,
        sentence: `Its live runs used this month's budget of ${formatCredits(monthlyCredits)} credits, so no new message starts a run until the budget is raised or the month ends.`,
        clearsWhen: "Once the budget is raised or removed, or on the 1st (UTC).",
        fix: { label: "Raise the budget", href },
      });
    }
    return alerts;
  });
}
