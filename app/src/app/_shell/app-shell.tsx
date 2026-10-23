// The app shell every signed-in page renders: the grouped sidebar with the page's own item
// marked, its counts read on each page load, and the page's title. Each page renders it rather
// than a layout, since a layout isn't rendered again on navigation (see `shell-data.ts`).
import { Suspense, type ReactNode } from "react";
import { findSessionCtx, getCtx } from "@/features/orgs/server";
import type { NavKey } from "./nav-model";
import { loadShell } from "./shell-data";
import { ShellFrame, type ShellWidth } from "./shell-frame";
import { SidebarBody } from "./sidebar-body";

export function AppShell({
  current,
  title,
  actions,
  width,
  signedOut = "redirect",
  children,
}: {
  /** The sidebar item that is this page; left out on a page that's none of them. */
  current?: NavKey;
  title: string;
  actions?: ReactNode;
  width?: ShellWidth;
  /**
   * With nobody signed in, `redirect` sends them to sign-in, as every page's own reads do;
   * `allow` draws the shell with the items everyone has (the not-found page).
   */
  signedOut?: "redirect" | "allow";
  children: ReactNode;
}) {
  return (
    <ShellFrame
      title={title}
      actions={actions}
      width={width}
      sidebar={
        // Until the shell's reads are back, the items everyone has, without counts.
        <Suspense fallback={<SidebarBody current={current} admin={false} counts={{}} />}>
          <LoadedSidebar current={current} signedOut={signedOut} />
        </Suspense>
      }
    >
      {children}
    </ShellFrame>
  );
}

async function LoadedSidebar({
  current,
  signedOut,
}: {
  current: NavKey | undefined;
  signedOut: "redirect" | "allow";
}) {
  const ctx = signedOut === "redirect" ? await getCtx() : await findSessionCtx();
  if (ctx === undefined) return <SidebarBody current={current} admin={false} counts={{}} />;
  return <SidebarBody current={current} {...await loadShell(ctx)} />;
}
