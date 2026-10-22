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
import { recentInvites, recentMessages } from "@/features/runtime/server";
import { triggers } from "@/features/spec/triggers";
import type { Spec } from "@/features/spec/types";
import { getWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { AppNav } from "@/app/app-nav";

// A Server Action here may try the working spec on a message, model steps and all.
export const maxDuration = 300;

// The whole window: the conversations, then the chat beside the workflow's graph.
export default function ConversationPage({
  params,
  searchParams,
}: PageProps<"/builder/[conversationId]">) {
  return (
    <main className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight">Builder chat</h1>
          {/* Narrower than the conversation list's column, the list is a page of its own. */}
          <Link
            href="/builder"
            className="text-sm text-muted-foreground hover:text-foreground lg:hidden"
          >
            All conversations
          </Link>
        </div>
        <AppNav />
      </header>
      <Suspense
        fallback={<p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>}
      >
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
        ? { open: false, item: triggers[workflow.workingSpec.trigger.type].item }
        : await openTryIt(ctx, workflow.workingSpec);
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 lg:flex">
        <NewConversationButton />
        <ConversationList conversations={conversations} activeId={conversation.id} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                  workingSpec: workflow.workingSpec,
                  revision: workflow.revision,
                }
          }
          tryIt={tryIt}
        />
      </div>
    </div>
  );
}

// The open panel: the recent messages, or the recent invites when the spec starts on one.
async function openTryIt(ctx: Ctx, spec: Spec): Promise<ConversationTryIt> {
  const { item } = triggers[spec.trigger.type];
  const sources =
    item === "invite"
      ? await recentInvites(ctx, spec.credentials)
      : await recentMessages(ctx, spec.credentials);
  return { open: true, sources, item };
}
