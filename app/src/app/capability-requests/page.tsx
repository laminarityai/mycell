import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listConversations } from "@/features/builder/server";
import { listCapabilityRequests } from "@/features/custom-actions/server";
import { CapabilityRequestList } from "@/features/custom-actions/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function CapabilityRequestsPage() {
  return (
    <AppShell current="capability-requests" title="Capability requests">
      <p className="text-sm text-muted-foreground">
        What the builder chat asked Mycel&apos;s team to build, because it couldn&apos;t do it with
        one call. Our team updates each request&apos;s status here.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading requests…</p>}>
        <Requests />
      </Suspense>
    </AppShell>
  );
}

async function Requests() {
  const ctx = await getCtx();
  // Capability requests are admin-only, like the builder chat that files them.
  if (!isAdmin(ctx)) redirect("/");
  const [requests, conversations] = await Promise.all([
    listCapabilityRequests(ctx),
    listConversations(ctx),
  ]);
  const titles = Object.fromEntries(conversations.map((c) => [c.id, c.title]));
  return <CapabilityRequestList requests={requests} conversationTitles={titles} />;
}
