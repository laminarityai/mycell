import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { getMemorySettings } from "@/features/memory/server";
import { MemorySettingsPanel } from "@/features/memory/ui";
import { getCtx } from "@/features/orgs/server";
import { isAdmin } from "@/lib/ctx";

export default function MemoryPage() {
  return (
    <AppShell current="memory" title="Memory settings">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading memory…</p>}>
        <Settings />
      </Suspense>
    </AppShell>
  );
}

async function Settings() {
  const ctx = await getCtx();
  // Memory's settings are admin-only; members have no view of memory (ADR-0023).
  if (!isAdmin(ctx)) redirect("/");
  return <MemorySettingsPanel settings={await getMemorySettings(ctx)} />;
}
