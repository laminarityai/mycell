// The Calendar trigger's poll (M11): every minute, for each connection a Calendar-triggered
// workflow is switched on for, what changed on its primary calendar since Calendar's sync
// token, and a `calendar/invite.received` for each new invite. Only the sync token is kept
// (`trigger_cursors`), never the events (invariant 8): Calendar isn't a discovery source
// (ADR-0008).
//
// The first poll after a switch-on has no token: it lists the whole calendar (a full sync) to
// get one, and starts nothing, so nothing from before the switch-on starts a run. When Google
// expires the token (410), the poll starts over with a full sync the same way. Each page is
// one step, so a retry after a crash lists nothing twice; the token is stored only once the
// last page is read, and the invites are announced in a step after that.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import { listStartable } from "@/features/workflows/server";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { InvariantError, NotFoundError } from "@/lib/errors";
import { type Json, type RunStep, runInline } from "@/lib/inngest";
import { listCalendarPage, type CalendarPage } from "./calendar";
import { sendInvitesReceived } from "./events";
import { triggerCursors } from "./schema";

const TRIGGER = "calendar.invite_received";

/** How one connection's poll ended. */
export type CalendarPollOutcome =
  // Nothing on the connection is switched on for new invites, or it can't reach Calendar.
  | { outcome: "skipped" }
  // The connection was deleted while the poll ran.
  | { outcome: "gone" }
  // A full sync, the first or after Google expired the token: a new token, and no runs.
  | { outcome: "synced" }
  // What changed since the token, and how many new invites it announced.
  | { outcome: "polled"; invites: number };

/**
 * Polls the connection's calendar for new invites, as the org's system ctx (ADR-0009). Invites
 * made before the earliest switch-on of a Calendar-triggered workflow on it are left out; the
 * fan-out checks each switch's own.
 */
export async function pollCalendar(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<CalendarPollOutcome> {
  requireSystem(ctx);
  const start = await runStep("calendar-start", () => untilGone(() => startOf(ctx, connectionId)));
  if (start.gone) return { outcome: "gone" };
  if (start.since === null) return { outcome: "skipped" };

  let listing: Listing | null = null;
  if (start.syncToken !== null) {
    listing = await listAll(ctx, connectionId, runStep, { syncToken: start.syncToken });
  }
  const full = listing === null || listing.expired;
  if (full) listing = await listAll(ctx, connectionId, runStep);
  if (listing === null || listing.gone) return { outcome: "gone" };
  if (listing.expired) throw new InvariantError("Calendar refused a full sync's page token");

  const { syncToken } = listing;
  const stored = await runStep("calendar-store", () =>
    untilGone(async () => {
      await storeSyncToken(ctx, connectionId, syncToken);
      return {};
    }),
  );
  if (stored.gone) return { outcome: "gone" };
  if (full) return { outcome: "synced" };

  const since = Date.parse(start.since);
  const invites = listing.invites.filter((invite) => Date.parse(invite.createdAt) >= since);
  await runStep("calendar-announce", async () => {
    await sendInvitesReceived(
      invites.map((invite) => ({
        orgId: ctx.orgId,
        connectionId,
        sourceRef: invite.eventId,
        occurredAt: new Date(invite.createdAt).toISOString(),
      })),
    );
    return { sent: invites.length };
  });
  return { outcome: "polled", invites: invites.length };
}

type Start = { since: string | null; syncToken: string | null };

// When the earliest Calendar-triggered switch on the connection came on (null when none is
// startable, or the connection can't reach Calendar now), and its stored sync token.
async function startOf(ctx: Ctx, connectionId: string): Promise<Start> {
  const connection = await getConnection(ctx, connectionId);
  if (connection.needsReauth || !connection.apps.includes("calendar")) {
    return { since: null, syncToken: null };
  }
  const switches = (await listStartable(ctx, connectionId)).filter(
    (on) => on.trigger.type === TRIGGER,
  );
  const times = switches.map((on) => on.since.getTime());
  if (times.length === 0) return { since: null, syncToken: null };
  const rows = await forOrg(ctx).select(triggerCursors, {
    where: and(eq(triggerCursors.connectionId, connectionId), eq(triggerCursors.trigger, TRIGGER)),
  });
  return {
    since: new Date(Math.min(...times)).toISOString(),
    syncToken: rows.at(0)?.cursor ?? null,
  };
}

type Invite = CalendarPage["invites"][number];
type Listing =
  | { gone: true; expired: false }
  | { gone: false; expired: true }
  | { gone: false; expired: false; syncToken: string; invites: Invite[] };

/**
 * Every page from `syncToken` (what changed since), or from the start without one (a full
 * sync, whose invites are left out: it starts nothing). `expired` when Google no longer
 * accepts the token.
 */
async function listAll(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep,
  from: { syncToken?: string } = {},
): Promise<Listing> {
  const incremental = from.syncToken !== undefined;
  const prefix = incremental ? "calendar-page" : "calendar-full-sync-page";
  const invites: Invite[] = [];
  let pageToken: string | undefined;
  for (let n = 1; ; n++) {
    const token = pageToken;
    const page = await runStep(`${prefix}-${String(n)}`, () =>
      untilGone(async () => {
        const found = await listCalendarPage(ctx, connectionId, {
          ...(token === undefined ? from : { pageToken: token }),
        });
        if (found === null) return { expired: true };
        return { expired: false, ...found, invites: incremental ? found.invites : [] } as const;
      }),
    );
    if (page.gone) return { gone: true, expired: false };
    if (page.expired) return { gone: false, expired: true };
    invites.push(...page.invites);
    if (page.nextSyncToken !== null) {
      return { gone: false, expired: false, syncToken: page.nextSyncToken, invites };
    }
    if (page.nextPageToken === null)
      throw new InvariantError("Calendar ended a listing with no token");
    pageToken = page.nextPageToken;
  }
}

// Keeps the connection's sync token, replacing the one before.
async function storeSyncToken(ctx: Ctx, connectionId: string, cursor: string): Promise<void> {
  const db = forOrg(ctx);
  const polledAt = new Date();
  const where = and(
    eq(triggerCursors.connectionId, connectionId),
    eq(triggerCursors.trigger, TRIGGER),
  );
  const updated = await db.update(triggerCursors, { cursor, polledAt }, where);
  if (updated.length > 0) return;
  await db.insert(triggerCursors, {
    id: randomUUID(),
    connectionId,
    trigger: TRIGGER,
    cursor,
    polledAt,
  });
}

type Gone<T> = ({ gone: false } & T) | { gone: true };

// Runs `work`, turning "the connection is gone" (deleted while the poll ran) into a result.
async function untilGone<T extends Record<string, Json>>(work: () => Promise<T>): Promise<Gone<T>> {
  try {
    return { gone: false, ...(await work()) };
  } catch (error) {
    if (error instanceof NotFoundError) return { gone: true };
    if (isForeignKeyViolation(error, "trigger_cursors_connection_fk")) return { gone: true };
    throw error;
  }
}
