// "What I've told Mycel" (M9): a person's own told facts, listed, deleted, and brought back.
// Only the teller reaches their told facts: anyone else, admins included, gets NotFoundError,
// and the system ctx ForbiddenError (it's no one, so it told nothing).
//
// Deleting is in two steps, so a delete can be undone. The fact is marked deleted
// (`deleted_at`), which takes it out of every read at once: the visibility rule sees a told
// fact only while it isn't deleted, so search, reads, citations and the teller's workflow runs
// no longer find it, and the older note it replaced is current again for them (`overTime`
// walks past a replacement the reader can't see). For TOLD_UNDO_MINUTES the teller can bring it
// back as it was, links and all. After that it's deleted for good: `memory/told-fact.deleted`'s
// job runs once the window ends, and the nightly retention sweeps any it missed. That hard
// delete goes through the usual triggers: whatever it replaced points past it, and an object
// only it was about goes too.
import { and, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireRole, requireSystem } from "@/lib/ctx";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { now } from "@/lib/time";
import { unique } from "@/lib/utils";
import {
  TOLD_UNDO_MINUTES,
  toldFactsFilterSchema,
  type DeletedToldFact,
  type ToldFactsFilter,
  type ToldNote,
  type ToldNotes,
} from "../types";
import { loggedReader, logRead } from "./access-log";
import { sendToldFactDeleted } from "./events";
import { facts, memoryObjects, objectKeys } from "./schema";

const UNDO_MS = TOLD_UNDO_MINUTES * 60_000;

type Row = Pick<
  typeof facts.$inferSelect,
  "id" | "subjectId" | "statement" | "recordedAt" | "supersededById" | "deletedAt"
>;

/**
 * The person's told facts the filter picks, newest first: the current ones, each with the older
 * note it replaced, and with `includeOlder` the replaced ones as rows of their own. Logged as
 * the person's read. The same queries for one note as for a hundred.
 */
export async function listToldFacts(ctx: Ctx, filter: ToldFactsFilter = {}): Promise<ToldNotes> {
  requireRole(ctx, "admin", "member");
  const parsed = toldFactsFilterSchema.safeParse(filter);
  if (!parsed.success) throw new ValidationError("Filter by a few words.");
  const { words = "", includeOlder = false } = parsed.data;
  const db = forOrg(ctx);
  // Deleted ones too: a replacement chain may run through one.
  const rows: Row[] = await db.select(facts, {
    columns: ["id", "subjectId", "statement", "recordedAt", "supersededById", "deletedAt"],
    where: eq(facts.toldByUserId, ctx.userId),
    orderBy: [desc(facts.recordedAt), desc(facts.id)],
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const live = rows.filter((row) => row.deletedAt === null);
  // Each live note's replacement among the live ones, past any deleted in between.
  const replacement = new Map<string, Row>();
  for (const row of live) {
    let next = row.supersededById === null ? undefined : byId.get(row.supersededById);
    const passed = new Set([row.id]);
    while (next !== undefined && next.deletedAt !== null && !passed.has(next.id)) {
      passed.add(next.id);
      next = next.supersededById === null ? undefined : byId.get(next.supersededById);
    }
    if (next !== undefined && next.deletedAt === null) replacement.set(row.id, next);
  }
  // The older notes each current note replaced, newest first (the order rows are in).
  const olderOf = new Map<string, Row[]>();
  for (const row of live) {
    let head = row;
    for (let next = replacement.get(head.id); next !== undefined; next = replacement.get(head.id)) {
      head = next;
    }
    if (head.id !== row.id) olderOf.set(head.id, [...(olderOf.get(head.id) ?? []), row]);
  }
  const current = live.filter((row) => !replacement.has(row.id));

  const subjects = await subjectsOf(ctx, unique(live.map((row) => row.subjectId)));
  const notes = (includeOlder ? live : current).flatMap((row): ToldNote[] => {
    const about = subjects.get(row.subjectId);
    if (about === undefined) return [];
    const older = olderOf.get(row.id) ?? [];
    const newer = replacement.get(row.id);
    const latest = older.at(0);
    return [
      {
        id: row.id,
        statement: row.statement,
        toldAt: row.recordedAt,
        about,
        replaced:
          latest === undefined ? null : { statement: latest.statement, earlier: older.length - 1 },
        replacedAt: newer?.recordedAt ?? null,
      },
    ];
  });
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = notes.filter((note) => {
    const text = [note.about.name, note.about.key ?? "", note.statement].join(" ").toLowerCase();
    return wanted.every((word) => text.includes(word));
  });
  await logRead(ctx, loggedReader(ctx, { kind: "person" }), {
    operation: "list_told",
    objectIds: shown.map((note) => note.about.id),
    factIds: shown.map((note) => note.id),
  });
  return { notes: shown, total: current.length };
}

// Who or what each note is about, with the address or domain it's known by.
async function subjectsOf(ctx: Ctx, ids: string[]): Promise<Map<string, ToldNote["about"]>> {
  if (ids.length === 0) return new Map();
  const db = forOrg(ctx);
  const objects = await db.select(memoryObjects, {
    columns: ["id", "kind", "name"],
    where: inArray(memoryObjects.id, ids),
  });
  const keys = await db.select(objectKeys, {
    columns: ["objectId", "kind", "value"],
    where: inArray(objectKeys.objectId, ids),
    orderBy: [objectKeys.kind, objectKeys.value],
  });
  return new Map(
    objects.map((object) => {
      const its = keys.filter((key) => key.objectId === object.id);
      // A person by their address, anything else by its domain, else whichever it has.
      const preferred = object.kind === "person" ? "email" : "domain";
      const key = its.find((k) => k.kind === preferred) ?? its.at(0);
      return [object.id, { ...object, key: key?.value ?? null }];
    }),
  );
}

/**
 * Deletes one of the person's told facts: no read sees it from now, and it can be brought back
 * until `undoUntil`, when it's deleted for good.
 */
export async function deleteToldFact(ctx: Ctx, id: string): Promise<DeletedToldFact> {
  requireRole(ctx, "admin", "member");
  const deletedAt = now();
  const row = (
    await forOrg(ctx).update(
      facts,
      { deletedAt },
      and(eq(facts.id, id), eq(facts.toldByUserId, ctx.userId), isNull(facts.deletedAt)),
    )
  ).at(0);
  if (row === undefined) throw new NotFoundError("note");
  const undoUntil = new Date(deletedAt.getTime() + UNDO_MS);
  await sendToldFactDeleted(ctx.orgId, undoUntil);
  return { id: row.id, statement: row.statement, undoUntil };
}

/** Brings back a told fact the person deleted, as it was, while its undo window lasts. */
export async function restoreToldFact(ctx: Ctx, id: string): Promise<void> {
  requireRole(ctx, "admin", "member");
  const db = forOrg(ctx);
  const mine = and(
    eq(facts.id, id),
    eq(facts.toldByUserId, ctx.userId),
    isNotNull(facts.deletedAt),
  );
  const row = (await db.select(facts, { columns: ["deletedAt"], where: mine })).at(0);
  if (row?.deletedAt == null) throw new NotFoundError("note");
  if (row.deletedAt.getTime() + UNDO_MS < now().getTime()) {
    throw new ConflictError("It's too late to undo: that note is gone.");
  }
  await db.update(facts, { deletedAt: null }, mine);
}

/**
 * Deletes for good the org's told facts deleted longer ago than the undo window, with whatever
 * only they were about. The org's system ctx only: `memory/told-fact.deleted`'s job and the
 * nightly retention.
 */
export async function purgeDeletedToldFacts(ctx: Ctx): Promise<{ facts: number }> {
  requireSystem(ctx);
  const cutoff = new Date(now().getTime() - UNDO_MS);
  const count = await forOrg(ctx).deleteCount(
    facts,
    and(isNotNull(facts.deletedAt), lt(facts.deletedAt, cutoff)),
  );
  return { facts: count };
}
