import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { listReviews } from "@/features/reviews/server";
import { ReviewsList } from "@/features/reviews/ui";
import { AppShell } from "@/app/_shell/app-shell";
import { now } from "@/lib/time";

// The landing page after sign-in, for everyone: what's waiting for the person (ADR-0013).
export default function ReviewsPage() {
  return (
    <AppShell current="reviews" title="Reviews">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading reviews…</p>}>
        <Reviews />
      </Suspense>
    </AppShell>
  );
}

async function Reviews() {
  const ctx = await getCtx();
  const reviews = await listReviews(ctx);
  return <ReviewsList reviews={reviews} viewerId={ctx.userId} now={now()} />;
}
