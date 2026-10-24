import { Suspense } from "react";
import { listRail } from "@/features/agent/server";
import { askQuerySchema } from "@/features/agent/types";
import { AskMycel, ToldFactsLink } from "@/features/agent/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";

// Ask Mycel with no conversation open: the person's conversations, or what their search (`?q=`)
// found, and New conversation.
export default function AskPage({ searchParams }: PageProps<"/ask">) {
  return (
    <AppShell current="ask" title="Ask Mycel" width="full" actions={<ToldFactsLink />}>
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
        <Conversations searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Conversations({ searchParams }: Pick<PageProps<"/ask">, "searchParams">) {
  const ctx = await getCtx();
  const { q } = askQuerySchema.parse(await searchParams);
  return <AskMycel rail={await listRail(ctx, q)} conversation={null} />;
}
