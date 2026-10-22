// The app navigation's links, kept apart from `AppNav` (which reads who's signed in on the
// server) so the error page, a client component, can show them too.
import Link from "next/link";
import { ReviewsNavLink } from "@/features/reviews/ui";

const LINK = "hover:text-foreground";

/** The nav's container, which `AppNav` and the error page share. */
export const NAV_CLASS =
  "flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground";

/** Reviews (with how many wait), Workflows, Connections, the org, and an admin's own pages. */
export function NavLinks({ waiting, admin }: { waiting: number; admin: boolean }) {
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
      <Link href="/memory/access-log" className={LINK}>
        Memory log
      </Link>
      {admin ? (
        <>
          <Link href="/tags" className={LINK}>
            Manage tags
          </Link>
          <Link href="/builder" className={LINK}>
            Builder chat
          </Link>
          <Link href="/memory" className={LINK}>
            Memory settings
          </Link>
          <Link href="/custom-actions" className={LINK}>
            Custom actions
          </Link>
          <Link href="/capability-requests" className={LINK}>
            Capability requests
          </Link>
        </>
      ) : null}
    </>
  );
}
