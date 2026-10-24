// The app shell every signed-in page renders: the grouped sidebar with the page's own item
// marked, its counts read on each page load, an admin's out-of-credits banner, and the page's
// title. Each page renders it rather than a layout, since a layout isn't rendered again on
// navigation (see `shell-data.ts`).
import { cache, Suspense, type ReactNode } from "react";
import { OutOfCreditsBanner } from "@/features/alerts/ui";
import { findSessionCtx, getCtx } from "@/features/orgs/server";
import type { NavKey } from "./nav-model";
import { loadShell, type ShellData } from "./shell-data";
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
  signedOut?: SignedOut;
  children: ReactNode;
}) {
  return (
    <ShellFrame
      title={title}
      actions={actions}
      width={width}
      banner={
        <Suspense fallback={null}>
          <LoadedBanner signedOut={signedOut} />
        </Suspense>
      }
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

type SignedOut = "redirect" | "allow";

/**
 * The shell's reads for whoever is signed in, or undefined with nobody (when allowed). React's
 * cache makes them one read per page render, shared by the sidebar and the banner.
 */
const loadedShell = cache(async (signedOut: SignedOut): Promise<ShellData | undefined> => {
  const ctx = signedOut === "redirect" ? await getCtx() : await findSessionCtx();
  return ctx === undefined ? undefined : loadShell(ctx);
});

async function LoadedSidebar({
  current,
  signedOut,
}: {
  current: NavKey | undefined;
  signedOut: SignedOut;
}) {
  const shell = await loadedShell(signedOut);
  if (shell === undefined) return <SidebarBody current={current} admin={false} counts={{}} />;
  return <SidebarBody current={current} {...shell} />;
}

/** Admins only (members never see the balance): the banner while credits are out. */
async function LoadedBanner({ signedOut }: { signedOut: SignedOut }) {
  const credits = (await loadedShell(signedOut))?.credits;
  return credits !== undefined && credits.balance <= 0 ? <OutOfCreditsBanner /> : null;
}
