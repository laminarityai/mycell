import { Suspense } from "react";
import { listConversations } from "@/features/agent/server";
import { AskMycel } from "@/features/agent/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";

// Ask Mycel with no conversation open: the person's conversations, and New conversation.
export default function AskPage() {
  return (
    <AppShell current="ask" title="Ask Mycel" width="full">
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
        <Conversations />
      </Suspense>
    </AppShell>
  );
}

async function Conversations() {
  const ctx = await getCtx();
  return <AskMycel conversations={await listConversations(ctx)} conversation={null} />;
}
