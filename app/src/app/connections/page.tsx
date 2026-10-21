import Link from "next/link";
import { Suspense } from "react";
import { listConnections } from "@/features/connections/server";
import { ConnectionsPanel } from "@/features/connections/ui";
import { getCtx } from "@/features/orgs/server";
import { countWaitingReviews } from "@/features/reviews/server";
import { ReviewsNavLink } from "@/features/reviews/ui";

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Suspense fallback={<span>Reviews</span>}>
            <WaitingReviews />
          </Suspense>
          <Link href="/org" className="hover:text-foreground">
            Back to your org
          </Link>
        </nav>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading connections…</p>}>
        <Connections />
      </Suspense>
    </main>
  );
}

async function Connections() {
  const ctx = await getCtx();
  return <ConnectionsPanel listing={await listConnections(ctx)} isAdmin={ctx.role === "admin"} />;
}

async function WaitingReviews() {
  const ctx = await getCtx();
  return (
    <ReviewsNavLink count={await countWaitingReviews(ctx)} className="hover:text-foreground" />
  );
}
