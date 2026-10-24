import { redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { creditsQuerySchema, type RangePreset } from "@/features/credits/types";
import { CreditsOverview, RangeControl } from "@/features/credits/ui";
import { getCtx } from "@/features/orgs/server";
import { isAdmin } from "@/lib/ctx";
import { loadCreditsPage } from "./credits-data";

// Where the company stands on credits over the range in the address (`?range=`, and Custom's
// `from` and `to`; this month by default): admins only. Members never see the balance or
// spending.
export default function CreditsPage({ searchParams }: PageProps<"/credits">) {
  return (
    <AppShell
      current="credits"
      title="Credits"
      width="wide"
      actions={
        <Suspense fallback={null}>
          <Range searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading credits…</p>}>
        <Credits searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

type Query = Pick<PageProps<"/credits">, "searchParams">;

// Read once per request: the range control beside the title and the page under it both show it.
const load = cache(async (preset: RangePreset, from?: string, to?: string) => {
  const ctx = await getCtx();
  if (!isAdmin(ctx)) redirect("/");
  return loadCreditsPage(ctx, new Date(), { preset, from, to });
});

async function read({ searchParams }: Query) {
  const { preset, from, to } = creditsQuerySchema.parse(await searchParams);
  return load(preset, from, to);
}

async function Range(query: Query) {
  return <RangeControl chosen={(await read(query)).chosen} />;
}

async function Credits(query: Query) {
  return <CreditsOverview {...await read(query)} />;
}
