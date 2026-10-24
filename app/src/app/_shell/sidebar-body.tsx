"use client";

// The sidebar's contents: the org's name, the grouped items with the current one marked and
// their counts, and the signed-in person at the foot. A client component so a link can close
// the menu on a narrow screen, and so the error page, which can't read who's signed in, draws
// it too.
import Link from "next/link";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/features/credits/format";
import type { Role } from "@/lib/ctx";
import { cn } from "@/lib/utils";
import { navGroupsFor, type NavCounts, type NavItem, type NavKey } from "./nav-model";
import { ShellMenuContext } from "./shell-frame";
import type { ShellCredits } from "./shell-data";

const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member" };

export function SidebarBody({
  current,
  admin,
  counts,
  viewer,
  orgName,
  credits,
}: {
  /** The item that is this page, if any (the error pages have none). */
  current?: NavKey;
  admin: boolean;
  counts: NavCounts;
  /** Left out, the foot is empty: while the shell loads, or with nobody signed in. */
  viewer?: { name: string; role: Role };
  orgName?: string;
  /** An admin's view of the company's credits; members get none. */
  credits?: ShellCredits;
}) {
  return (
    <>
      <div className="px-4 pt-5 pb-4">
        <p className="text-base font-semibold tracking-tight">Mycel</p>
        {orgName === undefined ? null : <p className="text-xs text-muted-foreground">{orgName}</p>}
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-4">
        {navGroupsFor(admin).map((group) => (
          <div
            key={group.key}
            role="group"
            aria-labelledby={`nav-${group.key}`}
            className="flex flex-col gap-0.5"
          >
            <p
              id={`nav-${group.key}`}
              className="px-2 pb-1 text-xs font-medium text-muted-foreground"
            >
              {group.label}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.key}
                item={item}
                current={item.key === current}
                count={counts[item.key] ?? 0}
              />
            ))}
          </div>
        ))}
      </nav>
      {viewer === undefined ? null : (
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs">
          {credits === undefined ? null : <CreditsFoot credits={credits} />}
          <div>
            <p className="font-medium break-all">{viewer.name}</p>
            <p className="text-muted-foreground">{ROLE_LABELS[viewer.role]}</p>
          </div>
        </div>
      )}
    </>
  );
}

/** The balance and its runway, linking to the Credits page. */
function CreditsFoot({ credits }: { credits: ShellCredits }) {
  const closeMenu = use(ShellMenuContext);
  const days = credits.runwayDays === null ? null : Math.floor(credits.runwayDays);
  return (
    <Link href="/credits" onClick={closeMenu} className="flex flex-col gap-0.5 hover:underline">
      {credits.balance <= 0 ? (
        <span className="font-medium text-destructive">Out of credits</span>
      ) : (
        <>
          <span className="font-medium tabular-nums">{formatCredits(credits.balance)} credits</span>
          <span className="text-muted-foreground">
            {days === null
              ? "No usage in the last 7 days"
              : `About ${String(days)} ${days === 1 ? "day" : "days"} at this week's rate`}
          </span>
        </>
      )}
    </Link>
  );
}

function NavLink({ item, current, count }: { item: NavItem; current: boolean; count: number }) {
  const closeMenu = use(ShellMenuContext);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      onClick={closeMenu}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-background hover:text-foreground",
        current && "bg-background font-medium text-foreground shadow-xs",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.counts === undefined || count === 0 ? null : (
        <Badge variant={item.counts.tone}>
          {count}
          <span className="sr-only"> {item.counts.label}</span>
        </Badge>
      )}
    </Link>
  );
}
