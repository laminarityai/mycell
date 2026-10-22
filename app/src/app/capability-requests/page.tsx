import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listConversations } from "@/features/builder/server";
import { listCapabilityRequests } from "@/features/custom-actions/server";
import { CapabilityRequestList } from "@/features/custom-actions/ui";
import { getCtx } from "@/features/orgs/server";
import { AppNav } from "@/app/app-nav";

export default function CapabilityRequestsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Capability requests</h1>
        <AppNav />
      </header>
      <p className="text-sm text-muted-foreground">
        What the builder chat asked Mycel&apos;s team to build, because it couldn&apos;t do it with
        one call. Our team updates each request&apos;s status here.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading requests…</p>}>
        <Requests />
      </Suspense>
    </main>
  );
}

async function Requests() {
  const ctx = await getCtx();
  // Capability requests are admin-only, like the builder chat that files them.
  if (ctx.role !== "admin") redirect("/");
  const [requests, conversations] = await Promise.all([
    listCapabilityRequests(ctx),
    listConversations(ctx),
  ]);
  const titles = Object.fromEntries(conversations.map((c) => [c.id, c.title]));
  return <CapabilityRequestList requests={requests} conversationTitles={titles} />;
}
