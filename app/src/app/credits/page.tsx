import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { CreditsOverview } from "@/features/credits/ui";
import { getCtx } from "@/features/orgs/server";
import { isAdmin } from "@/lib/ctx";
import { loadCreditsPage } from "./credits-data";

// Where the company stands on credits: admins only. Members never see the balance or spending.
export default function CreditsPage() {
  return (
    <AppShell current="credits" title="Credits" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading credits…</p>}>
        <Credits />
      </Suspense>
    </AppShell>
  );
}

async function Credits() {
  const ctx = await getCtx();
  if (!isAdmin(ctx)) redirect("/");
  return <CreditsOverview {...await loadCreditsPage(ctx, new Date())} />;
}
