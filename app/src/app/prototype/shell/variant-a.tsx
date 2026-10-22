// PROTOTYPE, throwaway: variant A, today's header kept as is: the h1 on the left and one flat,
// wrapping row of links on the right, now with all of v1's links (14 for an admin).
import Link from "next/link";
import { NAV_CLASS } from "@/app/nav-links";
import type { VariantProps } from "../_shared/prototype-page";
import { FLAT_ORDER, itemsFor, showsBanner } from "./nav-model";
import { NavCount, OutOfCreditsBanner, ReviewsSample } from "./shell-parts";

export function VariantA({ params }: VariantProps) {
  const admin = params.as === "admin";
  const items = itemsFor(admin).sort(
    (a, b) => FLAT_ORDER.indexOf(a.key) - FLAT_ORDER.indexOf(b.key),
  );
  return (
    <>
      {showsBanner(params) ? <OutOfCreditsBanner className="border-x-0 border-t-0" /> : null}
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
          <nav aria-label="Main" className={NAV_CLASS}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.key === "reviews" ? "page" : undefined}
                className="inline-flex items-center gap-1.5 hover:text-foreground aria-[current=page]:text-foreground"
              >
                {item.label}
                {item.count === undefined || item.count.value === 0 ? null : (
                  <NavCount {...item.count} />
                )}
              </Link>
            ))}
          </nav>
        </header>
        <ReviewsSample />
      </main>
    </>
  );
}
