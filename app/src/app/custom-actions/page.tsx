import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listCustomActions } from "@/features/custom-actions/server";
import { CustomActionList } from "@/features/custom-actions/ui";
import { getCtx, userNames } from "@/features/orgs/server";
import { workflowsUsingActions } from "@/features/workflows/server";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function CustomActionsPage() {
  return (
    <AppShell current="custom-actions" title="Custom actions">
      <p className="text-sm text-muted-foreground">
        The actions the builder chat described for your org when no catalog action fit: each makes
        one call to an app, at the level Mycel&apos;s fixed rule set. A custom action never changes
        once accepted.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading actions…</p>}>
        <Actions />
      </Suspense>
    </AppShell>
  );
}

async function Actions() {
  const ctx = await getCtx();
  // Custom actions come from the builder chat, which is admin-only, and so is this page.
  if (!isAdmin(ctx)) redirect("/");
  const [actions, nameOf] = await Promise.all([listCustomActions(ctx), userNames(ctx)]);
  const uses = await workflowsUsingActions(
    ctx,
    actions.map((action) => action.name),
  );
  return <CustomActionList actions={actions} uses={uses} nameOf={nameOf} />;
}
