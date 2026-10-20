import Link from "next/link";
import { Suspense } from "react";
import { listConnections } from "@/features/connections/server";
import { ConnectionsPanel } from "@/features/connections/ui";
import { getCtx } from "@/features/orgs/server";

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
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
