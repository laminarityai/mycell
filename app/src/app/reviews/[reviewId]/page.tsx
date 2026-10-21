import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { openReview } from "@/features/reviews/server";
import { ReviewDetail } from "@/features/reviews/ui";
import { NotFoundError } from "@/lib/errors";

export default function ReviewPage({ params }: PageProps<"/reviews/[reviewId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
        <Link href="/reviews" className="text-sm text-muted-foreground hover:text-foreground">
          Back to reviews
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Opening the review…</p>}>
        <Review params={params} />
      </Suspense>
    </main>
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
  return <ReviewDetail opened={opened} now={new Date()} />;
}
