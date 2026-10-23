import { Suspense } from "react";
import { listConnections } from "@/features/connections/server";
import { ConnectionsPanel } from "@/features/connections/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function ConnectionsPage() {
  return (
    <AppShell current="connections" title="Connections" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading connections…</p>}>
        <Connections />
      </Suspense>
    </AppShell>
  );
}

async function Connections() {
  const ctx = await getCtx();
  return <ConnectionsPanel listing={await listConnections(ctx)} isAdmin={isAdmin(ctx)} />;
}
