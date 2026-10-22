// PROTOTYPE, throwaway: the navigation chosen in round 1 (shell variant B, a grouped left
// sidebar), as a frame any prototype page can sit in. Round-2 variants use it so they're judged
// in the shell they'll ship in. Who's looking comes from the `as` toggle; `credits=out` shows
// the admin's out-of-credits banner.
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ORG, viewerFor } from "./fixtures";
import {
  CREDIT_STATUS,
  formatCredits,
  GROUP_LABELS,
  itemsFor,
  type NavGroup,
  showsBanner,
} from "../shell/nav-model";
import { NavCount, OutOfCreditsBanner } from "../shell/shell-parts";

const GROUPS: NavGroup[] = ["work", "company", "accounts"];

export function SidebarShell({
  params,
  current,
  title,
  subtitle,
  actions,
  width = "default",
  children,
}: {
  params: Record<string, string>;
  /** The nav item's key that is this page: "credits", "alerts", "ask", "workflows"… */
  current: string;
  /** Left out, the page draws its own heading (a chat, say). */
  title?: string;
  subtitle?: ReactNode;
  /** Beside the title, right-aligned. */
  actions?: ReactNode;
  /** `default` is a reading column, `wide` fills the content area, `bleed` drops the padding. */
  width?: "default" | "wide" | "bleed";
  children: ReactNode;
}) {
  const admin = params.as !== "member";
  const out = params.credits === "out";
  const viewer = viewerFor(admin ? "admin" : "member");
  const items = itemsFor(admin);
  return (
    <div className="flex min-h-[calc(100svh-1.25rem)]">
      <aside className="sticky top-0 flex h-[calc(100svh-1.25rem)] w-60 shrink-0 flex-col border-r bg-muted/40">
        <div className="px-4 pt-5 pb-4">
          <p className="text-base font-semibold tracking-tight">Mycel</p>
          <p className="text-xs text-muted-foreground">{ORG.name}</p>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-4">
          {GROUPS.map((group) => {
            const links = items.filter((item) => item.group === group);
            if (links.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-0.5">
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {GROUP_LABELS[group]}
                </p>
                {links.map((item) => {
                  const Icon = item.icon;
                  const here = item.key === current;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-background hover:text-foreground",
                        here && "bg-background font-medium text-foreground shadow-xs",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.key === "credits" && out ? (
                        <span className="size-2 rounded-full bg-destructive" aria-label="out" />
                      ) : null}
                      {item.count === undefined || item.count.value === 0 ? null : (
                        <NavCount {...item.count} />
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs">
          {admin ? (
            <Link href="/prototype/credits" className="flex flex-col gap-0.5 hover:underline">
              {out ? (
                <span className="font-medium text-destructive">Out of credits</span>
              ) : (
                <>
                  <span className="font-medium">
                    {formatCredits(CREDIT_STATUS.balance)} credits
                  </span>
                  <span className="text-muted-foreground">
                    About {CREDIT_STATUS.runwayDays} days at this week&apos;s rate
                  </span>
                </>
              )}
            </Link>
          ) : null}
          <div>
            <p className="font-medium">{viewer.name}</p>
            <p className="text-muted-foreground">{admin ? "Admin" : "Member"}</p>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {showsBanner(params) ? <OutOfCreditsBanner className="border-x-0 border-t-0" /> : null}
        <main
          className={cn(
            "flex w-full flex-1 flex-col gap-6",
            width === "default" && "max-w-3xl px-8 py-6",
            width === "wide" && "px-8 py-6",
          )}
        >
          {title === undefined ? null : (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {subtitle === undefined ? null : (
                  <p className="text-sm text-muted-foreground">{subtitle}</p>
                )}
              </div>
              {actions}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Round-2 pages take the `as` and `credits` toggles the sidebar responds to. */
export const SHELL_TOGGLES = [
  { param: "as", options: ["admin", "member"] },
  { param: "credits", options: ["ok", "out"] },
];
