// The Calendar poll (M11): every minute, for each connection a Calendar-triggered workflow is
// switched on for, or any connection granted Calendar once memory has started in its org
// (ADR-0029), what changed on its primary calendar since Calendar's sync token. It sends a
// `calendar/invite.received` for each new invite, for the trigger, and, while memory has started,
// a `calendar/event.changed` or `calendar/event.removed` for each event made, changed or gone, for
// memory. Only the sync token is kept (`trigger_cursors`), never the events (invariant 8):
// Calendar isn't a discovery source (ADR-0008), and memory keeps its own pointers.
//
// The first poll has no token: it lists the whole calendar (a full sync) to get one, and starts
// nothing and tells memory nothing, so nothing from before starts a run or is learned. When
// Google expires the token (410), the poll starts over with a full sync the same way. Each page is
// one step, so a retry after a crash lists nothing twice; the token is stored only once the
// last page is read, and the invites and changes are announced in a step after that.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import { hasMemoryStarted } from "@/features/memory/server";
import { listStartable } from "@/features/workflows/server";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { InvariantError, NotFoundError } from "@/lib/errors";
import { sendCalendarEventsChanged } from "@/lib/events";
import { type Json, type RunStep, runInline } from "@/lib/inngest";
import { listCalendarPage, type CalendarPage } from "./calendar";
import { sendInvitesReceived } from "./events";
import { triggerCursors } from "./schema";

const TRIGGER = "calendar.invite_received";

/** How one connection's poll ended. */
export type CalendarPollOutcome =
  // Nothing on the connection is switched on for new invites and memory hasn't started, or it
  // can't reach Calendar.
  | { outcome: "skipped" }
  // The connection was deleted while the poll ran.
  | { outcome: "gone" }
  // A full sync, the first or after Google expired the token: a new token, and no runs.
  | { outcome: "synced" }
  // What changed since the token, and how many new invites it announced.
  | { outcome: "polled"; invites: number };

/**
 * Polls the connection's calendar for new invites and, once memory has started, for what memory
 * follows, as the org's system ctx (ADR-0009). Invites made before the earliest switch-on of a
 * Calendar-triggered workflow on it are left out; the fan-out checks each switch's own.
 */
export async function pollCalendar(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep = runInline,
): Promise<CalendarPollOutcome> {
  requireSystem(ctx);
  const start = await runStep("calendar-start", () => untilGone(() => startOf(ctx, connectionId)));
  if (start.gone) return { outcome: "gone" };
  if (start.since === null && !start.memory) return { outcome: "skipped" };

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
  if (full || start.syncToken === null) return { outcome: "synced" };

  const since = start.since === null ? null : Date.parse(start.since);
  const invites =
    since === null ? [] : listing.invites.filter((invite) => Date.parse(invite.createdAt) >= since);
  const from = start.syncToken;
  const { changed, removed } = listing;
  await runStep("calendar-announce", async () => {
    const orgId = ctx.orgId;
    await sendInvitesReceived(
      invites.map((invite) => ({
        orgId,
        connectionId,
        sourceRef: invite.eventId,
        occurredAt: new Date(invite.createdAt).toISOString(),
      })),
    );
    if (start.memory) {
      await sendCalendarEventsChanged(
        changed.map((event) => ({
          orgId,
          connectionId,
          app: "calendar" as const,
          sourceRef: `${event.eventId}@${String(event.sequence)}`,
          occurredAt: new Date(event.updatedAt).toISOString(),
        })),
        removed.map((itemId) => ({ orgId, connectionId, app: "calendar" as const, itemId })),
        from,
      );
    }
    return { sent: invites.length };
  });
  return { outcome: "polled", invites: invites.length };
}

type Start = { since: string | null; memory: boolean; syncToken: string | null };

// When the earliest Calendar-triggered switch on the connection came on (null when none is
// startable), whether memory has started (both false when the connection can't reach Calendar
// now), and its stored sync token.
async function startOf(ctx: Ctx, connectionId: string): Promise<Start> {
  const connection = await getConnection(ctx, connectionId);
  if (connection.needsReauth || !connection.apps.includes("calendar")) {
    return { since: null, memory: false, syncToken: null };
  }
  const switches = (await listStartable(ctx, connectionId)).filter(
    (on) => on.trigger.type === TRIGGER,
  );
  const times = switches.map((on) => on.since.getTime());
  const memory = await hasMemoryStarted(ctx);
  if (times.length === 0 && !memory) return { since: null, memory, syncToken: null };
  const rows = await forOrg(ctx).select(triggerCursors, {
    where: and(eq(triggerCursors.connectionId, connectionId), eq(triggerCursors.trigger, TRIGGER)),
  });
  return {
    since: times.length === 0 ? null : new Date(Math.min(...times)).toISOString(),
    memory,
    syncToken: rows.at(0)?.cursor ?? null,
  };
}

type Found = Pick<CalendarPage, "invites" | "changed" | "removed">;
type Listing =
  | { gone: true; expired: false }
  | { gone: false; expired: true }
  | ({ gone: false; expired: false; syncToken: string } & Found);

/**
 * Every page from `syncToken` (what changed since), or from the start without one (a full
 * sync, whose invites and changes are left out: it starts nothing and teaches nothing).
 * `expired` when Google no longer accepts the token.
 */
async function listAll(
  ctx: Ctx,
  connectionId: string,
  runStep: RunStep,
  from: { syncToken?: string } = {},
): Promise<Listing> {
  const incremental = from.syncToken !== undefined;
  const prefix = incremental ? "calendar-page" : "calendar-full-sync-page";
  const found: Found = { invites: [], changed: [], removed: [] };
  let pageToken: string | undefined;
  for (let n = 1; ; n++) {
    const token = pageToken;
    const page = await runStep(`${prefix}-${String(n)}`, () =>
      untilGone(async () => {
        const listed = await listCalendarPage(ctx, connectionId, {
          ...(token === undefined ? from : { pageToken: token }),
        });
        if (listed === null) return { expired: true };
        if (incremental) return { expired: false, ...listed } as const;
        return { expired: false, ...listed, invites: [], changed: [], removed: [] } as const;
      }),
    );
    if (page.gone) return { gone: true, expired: false };
    if (page.expired) return { gone: false, expired: true };
    found.invites.push(...page.invites);
    found.changed.push(...page.changed);
    found.removed.push(...page.removed);
    if (page.nextSyncToken !== null) {
      return { gone: false, expired: false, syncToken: page.nextSyncToken, ...found };
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
