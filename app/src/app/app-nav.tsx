// The app's navigation, which every signed-in page renders in its header, with the count of
// reviews waiting for the person (`countWaitingReviews`). It's rendered by each page rather than
// a layout because a layout isn't rendered again when navigating between its pages, and the
// count is read on each page load.
import Link from "next/link";
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { countWaitingReviews } from "@/features/reviews/server";
import { ReviewsNavLink } from "@/features/reviews/ui";

const LINK = "hover:text-foreground";

/** Reviews (with how many wait), Workflows, Connections, the org, and an admin's own pages. */
export function AppNav() {
  return (
    <nav
      aria-label="Main"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
    >
      {/* Until the count is read, the links everyone has, without it. */}
      <Suspense fallback={<NavLinks waiting={0} admin={false} />}>
        <CountedNavLinks />
      </Suspense>
    </nav>
  );
}

async function CountedNavLinks() {
  const ctx = await getCtx();
  return <NavLinks waiting={await countWaitingReviews(ctx)} admin={ctx.role === "admin"} />;
}

function NavLinks({ waiting, admin }: { waiting: number; admin: boolean }) {
  return (
    <>
      <ReviewsNavLink count={waiting} className={LINK} />
      <Link href="/workflows" className={LINK}>
        Workflows
      </Link>
      <Link href="/connections" className={LINK}>
        Connections
      </Link>
      <Link href="/org" className={LINK}>
        Your org
      </Link>
      {admin ? (
        <>
          <Link href="/tags" className={LINK}>
            Manage tags
          </Link>
          <Link href="/builder" className={LINK}>
            Builder chat
          </Link>
        </>
      ) : null}
    </>
  );
}
