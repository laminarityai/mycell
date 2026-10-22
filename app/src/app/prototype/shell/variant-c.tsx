// PROTOTYPE, throwaway: variant C, a slim sticky top bar: only the daily links stay in view
// (Reviews, Workflows, Runs, and an admin's Alerts bell), everything else sits behind one
// "Admin" menu, and Ask Mycel is a persistent launcher in the bar that opens a docked panel.
import Link from "next/link";
import { Bell, CircleAlert } from "lucide-react";
import { ORG } from "../_shared/fixtures";
import type { VariantProps } from "../_shared/prototype-page";
import { itemsFor, showsBanner } from "./nav-model";
import { NavCount, ReviewsSample } from "./shell-parts";
import { AskLauncher, MoreMenu } from "./variant-c-menus";

export function VariantC({ params }: VariantProps) {
  const admin = params.as === "admin";
  const out = params.credits === "out";
  const daily = itemsFor(admin).filter(
    (item) => item.daily && item.key !== "ask" && item.key !== "alerts",
  );
  const alerts = itemsFor(admin).find((item) => item.key === "alerts");
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-1 px-4">
          <Link href="#" className="mr-4 flex items-baseline gap-2">
            <span className="font-semibold tracking-tight">Mycel</span>
            <span className="hidden text-xs text-muted-foreground lg:inline">{ORG.name}</span>
          </Link>
          <nav aria-label="Main" className="flex h-full items-stretch gap-1 text-sm">
            {daily.map((item) => {
              const current = item.key === "reviews";
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className="flex items-center gap-1.5 border-b-2 border-transparent px-2.5 text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
                >
                  {item.label}
                  {item.count === undefined ? null : <NavCount {...item.count} />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <AskLauncher />
            {alerts?.count === undefined ? null : (
              <Link
                href={alerts.href}
                className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Bell className="size-4" aria-hidden />
                <span className="sr-only">Alerts</span>
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
                  {alerts.count.value}
                  <span className="sr-only"> open</span>
                </span>
              </Link>
            )}
            <MoreMenu admin={admin} out={out} />
          </div>
        </div>
        {showsBanner(params) ? (
          <div
            role="alert"
            className="flex items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-xs font-medium text-white"
          >
            <CircleAlert className="size-3.5" aria-hidden />
            Out of credits: every workflow is paused until the Mycel team grants more.
            <Link href="/prototype/credits" className="underline underline-offset-2">
              See credits
            </Link>
          </div>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <ReviewsSample />
      </main>
    </>
  );
}
