// The app's navigation, which every signed-in page renders in its header, with the count of
// reviews waiting for the person (`countWaitingReviews`). It's rendered by each page rather than
// a layout because a layout isn't rendered again when navigating between its pages, and the
// count is read on each page load.
import { Suspense } from "react";
import { getCtx } from "@/features/orgs/server";
import { countWaitingReviews } from "@/features/reviews/server";
import { NAV_CLASS, NavLinks } from "./nav-links";

/** Reviews (with how many wait), Workflows, Connections, the org, and an admin's own pages. */
export function AppNav() {
  return (
    <nav aria-label="Main" className={NAV_CLASS}>
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
