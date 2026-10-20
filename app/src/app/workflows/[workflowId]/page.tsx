import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { getWorkflow } from "@/features/workflows/server";
import { WorkflowEditor } from "@/features/workflows/ui";
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
  return <WorkflowEditor workflow={workflow} />;
}
