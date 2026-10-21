import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { listRuns } from "@/features/runtime/server";
import { RecentRuns, RunOnMessageForm } from "@/features/runtime/ui";
import { editorConnections, getWorkflow, runnableConnections } from "@/features/workflows/server";
import { WorkflowEditor, WorkflowSwitchSection } from "@/features/workflows/ui";
import { NotFoundError } from "@/lib/errors";

export default function WorkflowPage({ params }: PageProps<"/workflows/[workflowId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow</h1>
        <Link href="/workflows" className="text-sm text-muted-foreground hover:text-foreground">
          Back to workflows
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflow…</p>}>
        <Workflow params={params} />
      </Suspense>
    </main>
  );
}

async function Workflow({ params }: Pick<PageProps<"/workflows/[workflowId]">, "params">) {
  const ctx = await getCtx();
  if (ctx.role !== "admin") redirect("/");
  const { workflowId } = await params;
  const workflow = await getWorkflow(ctx, workflowId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [runs, runnable, editing] = await Promise.all([
    listRuns(ctx, workflowId),
    runnableConnections(ctx, workflowId),
    editorConnections(ctx),
  ]);
  // Only the connections a run could use, the one it's switched on for first.
  const connections = runnable.map((connection) => ({
    id: connection.id,
    label: connection.accountEmail,
  }));
  return (
    <div className="flex flex-col gap-8">
      <WorkflowEditor workflow={workflow} connections={editing} />
      <WorkflowSwitchSection workflow={workflow} connections={connections} />
      <section className="flex flex-col gap-3" aria-label="Runs">
        <h2 className="text-lg font-semibold">Runs</h2>
        <RunOnMessageForm workflowId={workflow.id} connections={connections} />
        <RecentRuns runs={runs} />
      </section>
    </div>
  );
}
