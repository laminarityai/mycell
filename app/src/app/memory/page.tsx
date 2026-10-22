import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppNav } from "@/app/app-nav";
import { getMemorySettings } from "@/features/memory/server";
import { MemorySettingsPanel } from "@/features/memory/ui";
import { getCtx } from "@/features/orgs/server";

export default function MemoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Memory settings</h1>
        <AppNav />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading memory…</p>}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  const ctx = await getCtx();
  // Memory's settings are admin-only; members have no view of memory (ADR-0023).
  if (ctx.role !== "admin") redirect("/");
  return <MemorySettingsPanel settings={await getMemorySettings(ctx)} />;
}
