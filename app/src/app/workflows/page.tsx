import Link from "next/link";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { reviewStats } from "@/features/reviews/server";
import { reviewPeriodOf, sinceOf, type ReviewPeriod } from "@/features/reviews/types";
import { ReviewCountsSection, type ReviewCountsRow } from "@/features/reviews/ui";
import { listEnablements, listVisibleWorkflows, listWorkflows } from "@/features/workflows/server";
import { VisibleWorkflowsList, WorkflowsList } from "@/features/workflows/ui";
import type { Ctx } from "@/lib/ctx";

export default function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <Link href="/org" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
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
  const period = reviewPeriodOf((await searchParams).period);
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
          rows={await countRows(ctx, workflows, period, false)}
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
        rows={await countRows(ctx, published, period, true)}
      />
    </>
  );
}

// Each workflow's review counts over the period, and with `perMember` each person's under it.
async function countRows(
  ctx: Ctx,
  workflows: { id: string; name: string }[],
  period: ReviewPeriod,
  perMember: boolean,
): Promise<ReviewCountsRow[]> {
  const since = sinceOf(period, new Date());
  const counted = await Promise.all(
    workflows.map(async (workflow) => {
      const stats = await reviewStats(ctx, {
        workflowId: workflow.id,
        since,
        ...(perMember ? { groupBy: "user" as const } : {}),
      });
      return [
        { key: workflow.id, label: workflow.name, tally: stats },
        ...stats.byUser.map((row) => ({
          key: `${workflow.id}-${row.user?.id ?? "shared"}`,
          label: row.user?.name ?? "Shared inbox",
          person: true,
          tally: row,
        })),
      ];
    }),
  );
  return counted.flat();
}
