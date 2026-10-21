import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listConversations } from "@/features/builder/server";
import { ConversationList, NewConversationButton } from "@/features/builder/ui";
import { getCtx } from "@/features/orgs/server";
import { AppNav } from "@/app/app-nav";

export default function BuilderPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Builder chat</h1>
        <AppNav />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversations…</p>}>
        <Conversations />
      </Suspense>
    </main>
  );
}

async function Conversations() {
  const ctx = await getCtx();
  // The builder chat is admin-only.
  if (ctx.role !== "admin") redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <NewConversationButton />
      <ConversationList conversations={await listConversations(ctx)} />
    </div>
  );
}
