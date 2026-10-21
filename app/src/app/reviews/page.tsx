import { Suspense } from "react";
import { reviewDigestOn } from "@/features/notifications/server";
import { ReviewDigestSwitch } from "@/features/notifications/ui";
import { getCtx } from "@/features/orgs/server";
import { listReviews } from "@/features/reviews/server";
import { ReviewsList } from "@/features/reviews/ui";
import { AppNav } from "@/app/app-nav";

// The landing page after sign-in, for everyone: what's waiting for the person (ADR-0013).
export default function ReviewsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <AppNav />
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading reviews…</p>}>
        <Reviews />
      </Suspense>
    </main>
  );
}

async function Reviews() {
  const ctx = await getCtx();
  const [reviews, digestOn] = await Promise.all([listReviews(ctx), reviewDigestOn(ctx)]);
  return (
    <>
      <ReviewsList reviews={reviews} viewerId={ctx.userId} now={new Date()} />
      <ReviewDigestSwitch on={digestOn} />
    </>
  );
}
