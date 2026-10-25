import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getConversation, listRail } from "@/features/agent/server";
import { askQuerySchema } from "@/features/agent/types";
import { AskMycel, ToldFactsLink } from "@/features/agent/ui";
import { getCtx } from "@/features/orgs/server";
import { NotFoundError } from "@/lib/errors";
import { AppShell } from "@/app/_shell/app-shell";

// The whole window beside the sidebar: the conversation rail, then the open conversation. Only
// its owner can open it; anyone else, admins included, gets "not found". The rail lists what the
// person's search (`?q=`) found, when there is one.
export default function AskConversationPage({
  params,
  searchParams,
}: PageProps<"/ask/[conversationId]">) {
  return (
    <AppShell
      current="ask"
      title="Ask Mycel"
      width="full"
      actions={
        <span className="flex items-center gap-4">
          {/* Narrower than the rail's column, the rail is the conversation-less page. */}
          <Link
            href="/ask"
            className="text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            All conversations
          </Link>
          <ToldFactsLink />
        </span>
      }
    >
      <Suspense
        fallback={<p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>}
      >
        <ConversationView params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function ConversationView({
  params,
  searchParams,
}: Pick<PageProps<"/ask/[conversationId]">, "params" | "searchParams">) {
  const ctx = await getCtx();
  const { conversationId } = await params;
  const { q } = askQuerySchema.parse(await searchParams);
  const [conversation, rail] = await Promise.all([
    getConversation(ctx, conversationId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listRail(ctx, q),
  ]);
  return <AskMycel rail={rail} conversation={conversation} />;
}
