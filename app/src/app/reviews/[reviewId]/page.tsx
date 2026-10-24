import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { openReview } from "@/features/reviews/server";
import { ReviewDetail } from "@/features/reviews/ui";
import { NotFoundError } from "@/lib/errors";
import { AppShell } from "@/app/_shell/app-shell";
import { now } from "@/lib/time";

export default function ReviewPage({ params }: PageProps<"/reviews/[reviewId]">) {
  return (
    <AppShell current="reviews" title="Review">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Opening the review…</p>}>
        <Review params={params} />
      </Suspense>
    </AppShell>
  );
}

// Opening it checks the draft in Gmail and fetches it live: nothing of it is stored.
async function Review({ params }: Pick<PageProps<"/reviews/[reviewId]">, "params">) {
  const ctx = await getCtx();
  const { reviewId } = await params;
  const opened = await openReview(ctx, reviewId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return <ReviewDetail opened={opened} viewerId={ctx.userId} now={now()} />;
}
