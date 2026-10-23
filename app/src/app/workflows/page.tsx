import Link from "next/link";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { reviewCountsByWorkflow } from "@/features/reviews/server";
import { reviewPeriodSchema } from "@/features/reviews/types";
import { ReviewCountsSection } from "@/features/reviews/ui";
import { listVisibleWorkflows } from "@/features/workflows/server";
import { VisibleWorkflowsList, WorkflowsList } from "@/features/workflows/ui";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";
import { adminWorkflows } from "./admin-workflows";

export default function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  return (
    <AppShell current="workflows" title="Workflows" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflows…</p>}>
        <Workflows searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

// Admins see and edit every workflow, with every review count per workflow and per member;
// members see those published to their tags, with their own counts.
async function Workflows({ searchParams }: Pick<PageProps<"/workflows">, "searchParams">) {
  const ctx = await getCtx();
  const period = reviewPeriodSchema.parse((await searchParams).period);
  if (!isAdmin(ctx)) {
    const workflows = await listVisibleWorkflows(ctx);
    return (
      <>
        <VisibleWorkflowsList workflows={workflows} />
        <ReviewCountsSection
          title="Your reviews"
          description="How the reviews in your own mailbox ended, per workflow."
          period={period}
          basePath="/workflows"
          rows={await reviewCountsByWorkflow(ctx, workflows, period)}
        />
      </>
    );
  }
  const { workflows, enablements, orgConnections, reviewCounts } = await adminWorkflows(
    ctx,
    period,
  );
  return (
    <>
      <Link
        href="/workflows/new"
        className="text-sm font-medium underline-offset-4 hover:underline"
      >
        New workflow
      </Link>
      <WorkflowsList
        workflows={workflows}
        enablements={enablements}
        orgConnections={orgConnections}
      />
      <ReviewCountsSection
        title="Reviews"
        description="How each workflow's reviews ended, and each member's under it. Counts only."
        period={period}
        basePath="/workflows"
        rows={reviewCounts}
      />
    </>
  );
}
