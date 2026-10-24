// What the app shell reads for the signed-in person on every page load: their name and role for
// the sidebar's foot, their org's name, the sidebar's counts, and for an admin the company's
// credits. Each page renders the shell itself, rather than a layout, because a layout isn't
// rendered again on navigation, and the counts must be read on each page load.
import "server-only";
import { countAlerts } from "@/features/alerts/server";
import { getRunway } from "@/features/credits/server";
import { findUser, getOrgSettings } from "@/features/orgs/server";
import { countWaitingReviews } from "@/features/reviews/server";
import { isAdmin, type Ctx, type Role } from "@/lib/ctx";
import { InvariantError } from "@/lib/errors";
import type { NavCounts } from "./nav-model";

export type ShellViewer = { name: string; role: Role };

/** The balance, and the days it lasts at this week's rate (null with no usage this week). */
export type ShellCredits = { balance: number; runwayDays: number | null };

export type ShellData = {
  admin: boolean;
  viewer: ShellViewer;
  orgName: string;
  /** Reviews waiting for them, and for an admin the open alerts. */
  counts: NavCounts;
  /** Admins only: members never see the company's balance. */
  credits?: ShellCredits;
};

/** The shell's reads, a fixed few whatever the page. */
export async function loadShell(ctx: Ctx): Promise<ShellData> {
  const admin = isAdmin(ctx);
  const [viewer, org, waiting, runway, alerts] = await Promise.all([
    findUser(ctx, ctx.userId),
    getOrgSettings(ctx),
    countWaitingReviews(ctx),
    admin ? getRunway(ctx) : undefined,
    admin ? countAlerts(ctx) : undefined,
  ]);
  // The ctx was just read from this person's membership.
  if (viewer === null) throw new InvariantError("The signed-in person isn't in their org");
  return {
    admin,
    viewer: { name: viewer.name, role: viewer.role },
    orgName: org.name,
    counts: { reviews: waiting, ...(alerts === undefined ? {} : { alerts }) },
    ...(runway === undefined
      ? {}
      : { credits: { balance: runway.balance, runwayDays: runway.days } }),
  };
}
