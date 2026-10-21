import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { NewWorkflowEditor } from "@/features/workflows/ui";

export default function NewWorkflowPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">New workflow</h1>
        <Link href="/workflows" className="text-sm text-muted-foreground hover:text-foreground">
          Back to workflows
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <NewWorkflow />
      </Suspense>
    </main>
  );
}

async function NewWorkflow() {
  const ctx = await getCtx();
  if (ctx.role !== "admin") redirect("/");
  return <NewWorkflowEditor />;
}
