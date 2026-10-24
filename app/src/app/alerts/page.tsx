import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/app/_shell/app-shell";
import { listAlerts } from "@/features/alerts/server";
import { AlertsOverview } from "@/features/alerts/ui";
import { getCtx } from "@/features/orgs/server";
import { isAdmin } from "@/lib/ctx";

// What needs an admin now, worked out on each visit. Members get no alerts: a member following
// a link here lands on their Reviews.
export default function AlertsPage() {
  return (
    <AppShell current="alerts" title="Alerts" width="wide">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading alerts…</p>}>
        <Alerts />
      </Suspense>
    </AppShell>
  );
}

async function Alerts() {
  const ctx = await getCtx();
  if (!isAdmin(ctx)) redirect("/reviews");
  return <AlertsOverview alerts={await listAlerts(ctx)} />;
}
