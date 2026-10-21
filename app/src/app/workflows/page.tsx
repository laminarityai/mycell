import Link from "next/link";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { listVisibleWorkflows, listWorkflows } from "@/features/workflows/server";
import { VisibleWorkflowsList, WorkflowsList } from "@/features/workflows/ui";

export default function WorkflowsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflows…</p>}>
        <Workflows />
      </Suspense>
    </main>
  );
}

// Admins see and edit every workflow; members see those published to their tags.
async function Workflows() {
  const ctx = await getCtx();
  if (ctx.role !== "admin") {
    return <VisibleWorkflowsList workflows={await listVisibleWorkflows(ctx)} />;
  }
  return (
    <>
      <Link
        href="/workflows/new"
        className="text-sm font-medium underline-offset-4 hover:underline"
      >
        New workflow
      </Link>
      <WorkflowsList workflows={await listWorkflows(ctx)} />
    </>
  );
}
