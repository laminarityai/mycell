import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getConversation, listConversations } from "@/features/builder/server";
import { Conversation, ConversationList, NewConversationButton } from "@/features/builder/ui";
import { getCtx } from "@/features/orgs/server";
import { NotFoundError } from "@/lib/errors";

export default function ConversationPage({ params }: PageProps<"/builder/[conversationId]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Builder chat</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversation…</p>}>
        <ConversationView params={params} />
      </Suspense>
    </main>
  );
}

async function ConversationView({
  params,
}: Pick<PageProps<"/builder/[conversationId]">, "params">) {
  const ctx = await getCtx();
  if (ctx.role !== "admin") redirect("/");
  const { conversationId } = await params;
  const [conversation, conversations] = await Promise.all([
    getConversation(ctx, conversationId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listConversations(ctx),
  ]);
  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside className="flex flex-col gap-3">
        <NewConversationButton />
        <ConversationList conversations={conversations} activeId={conversation.id} />
      </aside>
      <section aria-label="Conversation">
        <Conversation conversation={conversation} />
      </section>
    </div>
  );
}
