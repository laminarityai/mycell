// PROTOTYPE, throwaway: a page header as every real page draws it (reviews/page.tsx), with the
// real `NavLinks` on fixture counts plus the links v1 adds (Ask Mycel, Runs, Alerts, Credits).
// No sign-in: who is looking comes from the `as` toggle. The `shell` prototype explores other
// navigations; every other prototype uses this one.
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { NAV_CLASS, NavLinks } from "@/app/nav-links";
import { FIXTURE_COUNTS } from "./fixtures";

const LINK = "hover:text-foreground";

export function PrototypeHeader({
  title,
  admin,
  children,
}: {
  title: string;
  admin: boolean;
  /** Beside the title, e.g. a state badge. */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
      <PrototypeNav admin={admin} />
    </header>
  );
}

/** Today's nav plus v1's new links, as a flat row. */
export function PrototypeNav({ admin }: { admin: boolean }) {
  return (
    <nav aria-label="Main" className={NAV_CLASS}>
      <Link href="/prototype/ask" className={LINK}>
        Ask Mycel
      </Link>
      <NavLinks waiting={FIXTURE_COUNTS.waitingReviews} admin={admin} />
      <Link href="/prototype/runs" className={LINK}>
        Runs
      </Link>
      {admin ? (
        <>
          <Link href="/prototype/alerts" className={`${LINK} inline-flex items-center gap-1`}>
            Alerts <Badge variant="destructive">{FIXTURE_COUNTS.openAlerts}</Badge>
          </Link>
          <Link href="/prototype/credits" className={LINK}>
            Credits
          </Link>
        </>
      ) : null}
    </nav>
  );
}

/** The page body's container, as real pages use it. Wider pages pass `wide`. */
export function PrototypeMain({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={`mx-auto flex w-full ${wide ? "max-w-6xl" : "max-w-3xl"} flex-col gap-6 p-6`}>
      {children}
    </main>
  );
}

/** The `as` toggle every prototype with an admin/member difference uses. */
export const AS_TOGGLE = { param: "as", options: ["admin", "member"] };
