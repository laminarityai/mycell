import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listCustomActions } from "@/features/custom-actions/server";
import { getCtx } from "@/features/orgs/server";
import { ActionSetProvider, NewWorkflowEditor } from "@/features/workflows/ui";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function NewWorkflowPage() {
  return (
    <AppShell current="workflows" title="New workflow">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <NewWorkflow />
      </Suspense>
    </AppShell>
  );
}

async function NewWorkflow() {
  const ctx = await getCtx();
  if (!isAdmin(ctx)) redirect("/");
  return (
    <ActionSetProvider customActions={await listCustomActions(ctx)}>
      <NewWorkflowEditor />
    </ActionSetProvider>
  );
}
