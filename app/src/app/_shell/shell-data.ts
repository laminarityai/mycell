// What the app shell reads for the signed-in person on every page load: their name and role for
// the sidebar's foot, their org's name, and the sidebar's counts. Each page renders the shell
// itself, rather than a layout, because a layout isn't rendered again on navigation, and the
// counts must be read on each page load.
import "server-only";
import { findUser, getOrgSettings } from "@/features/orgs/server";
import { countWaitingReviews } from "@/features/reviews/server";
import { isAdmin, type Ctx, type Role } from "@/lib/ctx";
import { InvariantError } from "@/lib/errors";
import type { NavCounts } from "./nav-model";

export type ShellViewer = { name: string; role: Role };

export type ShellData = {
  admin: boolean;
  viewer: ShellViewer;
  orgName: string;
  /** M8 adds the open Alerts here. */
  counts: NavCounts;
};

/** The shell's reads, a fixed few whatever the page. */
export async function loadShell(ctx: Ctx): Promise<ShellData> {
  const [viewer, org, waiting] = await Promise.all([
    findUser(ctx, ctx.userId),
    getOrgSettings(ctx),
    countWaitingReviews(ctx),
  ]);
  // The ctx was just read from this person's membership.
  if (viewer === null) throw new InvariantError("The signed-in person isn't in their org");
  return {
    admin: isAdmin(ctx),
    viewer: { name: viewer.name, role: viewer.role },
    orgName: org.name,
    counts: { reviews: waiting },
  };
}
