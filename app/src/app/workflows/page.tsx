import Link from "next/link";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { countWaitingReviews, reviewCountsByWorkflow } from "@/features/reviews/server";
import { reviewPeriodSchema } from "@/features/reviews/types";
import { ReviewCountsSection, ReviewsNavLink } from "@/features/reviews/ui";
import { listEnablements, listVisibleWorkflows, listWorkflows } from "@/features/workflows/server";
import { VisibleWorkflowsList, WorkflowsList } from "@/features/workflows/ui";

export default function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Suspense fallback={<span>Reviews</span>}>
            <WaitingReviews />
          </Suspense>
          <Link href="/org" className="hover:text-foreground">
            Back to your org
          </Link>
        </nav>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflows…</p>}>
        <Workflows searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Admins see and edit every workflow, with every review count per workflow and per member;
// members see those published to their tags, with their own counts.
async function Workflows({ searchParams }: Pick<PageProps<"/workflows">, "searchParams">) {
  const ctx = await getCtx();
  const period = reviewPeriodSchema.parse((await searchParams).period);
  if (ctx.role !== "admin") {
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
  const workflows = await listWorkflows(ctx);
  const enablements = await Promise.all(
    workflows.map(
      async (workflow) => [workflow.id, await listEnablements(ctx, workflow.id)] as const,
    ),
  );
  const published = workflows.filter((workflow) => workflow.latestVersion !== null);
  return (
    <>
      <Link
        href="/workflows/new"
        className="text-sm font-medium underline-offset-4 hover:underline"
      >
        New workflow
      </Link>
      <WorkflowsList workflows={workflows} enablements={new Map(enablements)} />
      <ReviewCountsSection
        title="Reviews"
        description="How each workflow's reviews ended, and each member's under it. Counts only."
        period={period}
        basePath="/workflows"
        rows={await reviewCountsByWorkflow(ctx, published, period)}
      />
    </>
  );
}

async function WaitingReviews() {
  const ctx = await getCtx();
  return (
    <ReviewsNavLink count={await countWaitingReviews(ctx)} className="hover:text-foreground" />
  );
}
