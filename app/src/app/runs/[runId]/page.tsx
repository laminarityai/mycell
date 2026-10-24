import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { listCustomActions } from "@/features/custom-actions/server";
import { getCtx } from "@/features/orgs/server";
import { reviewsOfRun } from "@/features/reviews/server";
import { RunReviews } from "@/features/reviews/ui";
import { checkRetry, getRun, getRunMessage } from "@/features/runtime/server";
import { RunGraph, RunSummary } from "@/features/runtime/ui";
import { ActionSetProvider } from "@/features/workflows/ui";
import { isAdmin } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

// One run: what happened, its path lit on the graph of the version it ran, each step's details
// and the reviews it created. A colleague's run reaches an admin redacted, and a member only
// their own (ADR-0001).
export default function RunPage({ params }: PageProps<"/runs/[runId]">) {
  return (
    <AppShell current="runs" title="Run" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the run…</p>}>
        <Run params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Run({ params }: Pick<PageProps<"/runs/[runId]">, "params">) {
  const ctx = await getCtx();
  const { runId } = await params;
  // Read together: the message and the reviews are only ever the caller's to see.
  const [run, message, reviews, customActions, retry] = await Promise.all([
    getRun(ctx, runId).catch((error: unknown) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
    getRunMessage(ctx, runId),
    reviewsOfRun(ctx, runId),
    listCustomActions(ctx),
    checkRetry(ctx, runId),
  ]).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (run === null) return <NotYours />;
  const admin = isAdmin(ctx);
  return (
    // The graph looks its actions up in the company's action set, custom actions included.
    <ActionSetProvider customActions={customActions}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link
            href="/runs"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Runs
          </Link>
          <h2 className="text-lg font-semibold">{run.workflowName}</h2>
        </div>
        <RunSummary
          run={run}
          message={message}
          versionHref={admin ? `/workflows/${run.workflowId}` : null}
          retry={retry}
        />
        <section aria-label="Steps" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Steps</h2>
          {run.version === null ? (
            <p className="text-sm text-muted-foreground">The version this run ran is gone.</p>
          ) : (
            <RunGraph run={run} />
          )}
        </section>
        <section aria-label="Reviews" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Reviews</h2>
          <RunReviews reviews={reviews} />
        </section>
      </div>
    </ActionSetProvider>
  );
}

function NotYours() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">This run isn&apos;t yours to see</p>
      <p className="text-sm text-muted-foreground">
        It ran on a colleague&apos;s inbox. Your own runs are on the{" "}
        <Link href="/runs" className="underline underline-offset-4">
          Runs
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
