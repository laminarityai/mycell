import { Suspense } from "react";
import { listConnections } from "@/features/connections/server";
import { ConnectionsPanel } from "@/features/connections/ui";
import { getCtx } from "@/features/orgs/server";
import { AppNav } from "@/app/app-nav";

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <AppNav />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading connections…</p>}>
        <Connections />
      </Suspense>
    </main>
  );
}

async function Connections() {
  const ctx = await getCtx();
  return <ConnectionsPanel listing={await listConnections(ctx)} isAdmin={ctx.role === "admin"} />;
}
