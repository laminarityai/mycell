// PROTOTYPE, throwaway: variant B, a fixed left sidebar grouping the links by whose work they
// are ("Your work", "Company", "Accounts and memory"), with credits and the signed-in person at
// its foot. The page title moves into the content column.
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ORG, viewerFor } from "../_shared/fixtures";
import type { VariantProps } from "../_shared/prototype-page";
import {
  CREDIT_STATUS,
  formatCredits,
  GROUP_LABELS,
  itemsFor,
  type NavGroup,
  showsBanner,
} from "./nav-model";
import { NavCount, OutOfCreditsBanner, ReviewsSample } from "./shell-parts";

const GROUPS: NavGroup[] = ["work", "company", "accounts"];

export function VariantB({ params }: VariantProps) {
  const admin = params.as === "admin";
  const out = params.credits === "out";
  const viewer = viewerFor(params.as);
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
                  const current = item.key === "reviews";
                  const warn = item.key === "credits" && out;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-background hover:text-foreground",
                        current && "bg-background font-medium text-foreground shadow-xs",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {warn ? (
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
        <main className="flex w-full max-w-3xl flex-col gap-6 px-8 py-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
            <p className="text-sm text-muted-foreground">What&apos;s waiting for you.</p>
          </div>
          <ReviewsSample />
        </main>
      </div>
    </div>
  );
}
