import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getConversation, listConversations } from "@/features/agent/server";
import { AskMycel } from "@/features/agent/ui";
import { getCtx } from "@/features/orgs/server";
import { NotFoundError } from "@/lib/errors";
import { AppShell } from "@/app/_shell/app-shell";

// The whole window beside the sidebar: the conversation rail, then the open conversation. Only
// its owner can open it; anyone else, admins included, gets "not found".
export default function AskConversationPage({ params }: PageProps<"/ask/[conversationId]">) {
  return (
    <AppShell
      current="ask"
      title="Ask Mycel"
      width="full"
      actions={
        // Narrower than the rail's column, the rail is the conversation-less page.
        <Link href="/ask" className="text-sm text-muted-foreground hover:text-foreground md:hidden">
          All conversations
        </Link>
      }
    >
      <Suspense
        fallback={<p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>}
      >
        <ConversationView params={params} />
      </Suspense>
    </AppShell>
  );
}

async function ConversationView({ params }: Pick<PageProps<"/ask/[conversationId]">, "params">) {
  const ctx = await getCtx();
  const { conversationId } = await params;
  const [conversation, conversations] = await Promise.all([
    getConversation(ctx, conversationId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listConversations(ctx),
  ]);
  return <AskMycel conversations={conversations} conversation={conversation} />;
}
