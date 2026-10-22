import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listCustomActions } from "@/features/custom-actions/server";
import { CustomActionList } from "@/features/custom-actions/ui";
import { getCtx, userNames } from "@/features/orgs/server";
import { workflowsUsingActions } from "@/features/workflows/server";
import { AppNav } from "@/app/app-nav";

export default function CustomActionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Custom actions</h1>
        <AppNav />
      </header>
      <p className="text-sm text-muted-foreground">
        The actions the builder chat described for your company when no catalog action fit: each
        makes one call to an app, at the level Mycel&apos;s fixed rule set. A custom action never
        changes once accepted.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading actions…</p>}>
        <Actions />
      </Suspense>
    </main>
  );
}

async function Actions() {
  const ctx = await getCtx();
  // Custom actions come from the builder chat, which is admin-only, and so is this page.
  if (ctx.role !== "admin") redirect("/");
  const [actions, nameOf] = await Promise.all([listCustomActions(ctx), userNames(ctx)]);
  const uses = await workflowsUsingActions(
    ctx,
    actions.map((action) => action.name),
  );
  return <CustomActionList actions={actions} uses={uses} nameOf={nameOf} />;
}
