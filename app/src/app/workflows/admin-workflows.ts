// What the Workflows page reads for an admin, apart from rendering it, so a test can pin its
// query budget: the same queries for 1 workflow as for 100 (src/app/tests/workflows-page.test.ts).
import { reviewCountsByWorkflow } from "@/features/reviews/server";
import type { ReviewPeriod } from "@/features/reviews/types";
import {
  listEnablementsFor,
  listWorkflows,
  runnableConnectionsFor,
} from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";

/**
 * Every workflow, with each one's enablements, the connections each published org workflow's
 * switch may choose from, and every workflow's review counts over `period`.
 */
export async function adminWorkflows(ctx: Ctx, period: ReviewPeriod) {
  const workflows = await listWorkflows(ctx);
  const published = workflows.filter((workflow) => workflow.latestVersion !== null);
  const [enablements, runnable, reviewCounts] = await Promise.all([
    listEnablementsFor(
      ctx,
      workflows.map((workflow) => workflow.id),
    ),
    runnableConnectionsFor(
      ctx,
      published.filter((workflow) => workflow.credentials === "org").map((workflow) => workflow.id),
    ),
    reviewCountsByWorkflow(ctx, published, period),
  ]);
  const orgConnections = new Map(
    [...runnable].map(([workflowId, connections]) => [
      workflowId,
      connections.map((connection) => ({ id: connection.id, label: connection.accountEmail })),
    ]),
  );
  return { workflows, enablements, orgConnections, reviewCounts };
}
