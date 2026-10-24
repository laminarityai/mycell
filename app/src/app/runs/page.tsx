import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { getCtx } from "@/features/orgs/server";
import { listRunFilters, listRuns } from "@/features/runtime/server";
import { runsQuerySchema } from "@/features/runtime/types";
import { isFiltered, RunFilterBar, RunPager, RunsTable } from "@/features/runtime/ui";
import { isAdmin } from "@/lib/ctx";

// Runs across every workflow, newest first: every run in the company for an admin, a
// colleague's redacted; the runs on their own inbox for a member (ADR-0001).
export default function RunsPage({ searchParams }: PageProps<"/runs">) {
  return (
    <AppShell current="runs" title="Runs" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading runs…</p>}>
        <Runs searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Runs({ searchParams }: Pick<PageProps<"/runs">, "searchParams">) {
  const ctx = await getCtx();
  const admin = isAdmin(ctx);
  const { filters, page } = runsQuerySchema.parse(await searchParams);
  const [runs, options] = await Promise.all([listRuns(ctx, filters, page), listRunFilters(ctx)]);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {admin
          ? "Every run in the company, newest first. A run on a colleague's own inbox shows what happened, not the message it ran on."
          : "The runs of workflows on your inbox, newest first."}
      </p>
      <RunFilterBar filters={filters} options={options} showInbox={admin} />
      {runs.runs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {isFiltered(filters) ? "No runs match these filters." : "No runs yet."}
        </p>
      ) : (
        <RunsTable runs={runs.runs} showInbox={admin} />
      )}
      <RunPager filters={filters} page={runs} />
    </>
  );
}
