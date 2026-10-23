import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listConversations } from "@/features/builder/server";
import { ConversationList, NewConversationButton } from "@/features/builder/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";
import { isAdmin } from "@/lib/ctx";

export default function BuilderPage() {
  return (
    <AppShell current="builder" title="Builder chat">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversations…</p>}>
        <Conversations />
      </Suspense>
    </AppShell>
  );
}

async function Conversations() {
  const ctx = await getCtx();
  // The builder chat is admin-only.
  if (!isAdmin(ctx)) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <NewConversationButton />
      <ConversationList conversations={await listConversations(ctx)} />
    </div>
  );
}
