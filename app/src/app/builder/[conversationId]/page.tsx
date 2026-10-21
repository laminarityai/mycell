import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getConversation, listConversations, listProposals } from "@/features/builder/server";
import {
  Conversation,
  ConversationList,
  NewConversationButton,
  type ConversationTryIt,
} from "@/features/builder/ui";
import { getCtx } from "@/features/orgs/server";
import { recentMessages } from "@/features/runtime/server";
import { getWorkflow } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";

// A Server Action here may try the working spec on a message, model steps and all.
export const maxDuration = 300;

export default function ConversationPage({
  params,
  searchParams,
}: PageProps<"/builder/[conversationId]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Builder chat</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to your org
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversation…</p>}>
        <ConversationView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ConversationView({ params, searchParams }: PageProps<"/builder/[conversationId]">) {
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
  const [proposals, workflow] = await Promise.all([
    listProposals(ctx, conversation.id),
    conversation.workflowId === null ? null : getWorkflow(ctx, conversation.workflowId),
  ]);
  // The picker reads the inboxes only once the admin asks for it (`?try`).
  const tryIt: ConversationTryIt | null =
    workflow === null
      ? null
      : (await searchParams).try === undefined
        ? { open: false }
        : { open: true, sources: await recentMessages(ctx, workflow.workingSpec.credentials) };
  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside className="flex flex-col gap-3">
        <NewConversationButton />
        <ConversationList conversations={conversations} activeId={conversation.id} />
      </aside>
      <section aria-label="Conversation">
        <Conversation
          conversation={conversation}
          proposals={proposals}
          workflow={
            workflow === null
              ? null
              : {
                  id: workflow.id,
                  name: workflow.name,
                  unpublishedChanges: workflow.unpublishedChanges,
                }
          }
          tryIt={tryIt}
        />
      </section>
    </div>
  );
}
