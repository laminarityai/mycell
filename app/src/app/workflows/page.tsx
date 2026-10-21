import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { listWorkflows } from "@/features/workflows/server";
import { WorkflowsList } from "@/features/workflows/ui";

export default function WorkflowsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <Link href="/org" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
      </header>
      <Link
        href="/workflows/new"
        className="text-sm font-medium underline-offset-4 hover:underline"
      >
        New workflow
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflows…</p>}>
        <Workflows />
      </Suspense>
    </main>
  );
}

async function Workflows() {
  const ctx = await getCtx();
  // Workflows are admin-only in M3; members get them through tags in M5.
  if (ctx.role !== "admin") redirect("/");
  return <WorkflowsList workflows={await listWorkflows(ctx)} />;
}
