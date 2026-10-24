import { Suspense } from "react";
import { listToldFacts } from "@/features/memory/server";
import { toldFactsSearchSchema } from "@/features/agent/types";
import { ToldFacts } from "@/features/agent/ui";
import { getCtx } from "@/features/orgs/server";
import { AppShell } from "@/app/_shell/app-shell";

// "What I've told Mycel": the signed-in person's own told facts, filtered as the address says.
export default function ToldFactsPage({ searchParams }: PageProps<"/ask/told">) {
  return (
    <AppShell current="ask" title="What I've told Mycel" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading your notes…</p>}>
        <Notes searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Notes({ searchParams }: Pick<PageProps<"/ask/told">, "searchParams">) {
  const ctx = await getCtx();
  const { q, older } = toldFactsSearchSchema.parse(await searchParams);
  const listed = await listToldFacts(ctx, { words: q, includeOlder: older });
  return <ToldFacts listed={listed} words={q} includeOlder={older} />;
}
