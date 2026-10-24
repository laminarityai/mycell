// The nightly reconciliation: makes deletion certain even when a webhook was missed (Nango
// sends none for bulk deletes). It compares Mycel's connections with Nango's in both
// directions, inside each org as its system ctx (ADR-0009), one step per connection it acts on.
import { and, eq, gt } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { NangoRequestError } from "@/lib/errors";
import { runInline, type RunStep } from "@/lib/inngest";
import { DAY_MS, now as clockNow } from "@/lib/time";
import type { NangoConnectionRef, ReconciliationSummary } from "../types";
import { ATTEMPT_TAGS } from "./connect";
import {
  deleteNangoConnection,
  type ListedNangoConnection,
  listNangoConnections,
  nangoConnectionExists,
} from "./nango";
import { connectAttempts, connections } from "./schema";
import { integrationOf } from "./apps";

// Deleting more Nango connections than this in one run, when they are also most of what Nango
// lists, looks like Mycel misreading its own rows rather than real orphans: the run holds them.
const BULK_DELETE_AT_NANGO_LIMIT = 10;

type OurConnection = { orgId: string; connectionId: string; nango: NangoConnectionRef };

const keyOf = (ref: NangoConnectionRef) => `${ref.integration}/${ref.nangoConnectionId}`;

/**
 * Runs one reconciliation across every org. Mycel's connections that Nango no longer has are
 * deleted, once Nango confirms each by ID, and the cascade takes everything derived from them.
 * Nango connections Mycel has no connection for are deleted at Nango, unless a connect attempt
 * younger than a day may still record them. `now` is when the run happens (tests move it).
 *
 * One step reads both sides and names the connections to act on (`read`), then each connection
 * is one step: `confirm-<connection ID>` for one of Mycel's that Nango didn't list, and
 * `delete-at-nango-<integration>-<Nango connection ID>` for one of Nango's with no connection.
 * Each hands on IDs only.
 */
export async function reconcileConnections(
  now = clockNow(),
  runStep: RunStep = runInline,
): Promise<ReconciliationSummary> {
  const plan = await runStep("read", () => readBothSides(now));
  const summary: ReconciliationSummary = {
    deletedRows: [],
    keptUnconfirmed: [],
    deletedAtNango: [],
    heldAtNango: plan.held ? plan.orphans : [],
  };
  for (const connection of plan.missing) {
    const { orgId, connectionId } = connection;
    const { deleted } = await runStep(`confirm-${connectionId}`, () => confirmGone(connection));
    (deleted ? summary.deletedRows : summary.keptUnconfirmed).push({ orgId, connectionId });
  }
  if (plan.held) return summary;
  for (const orphan of plan.orphans) {
    const id = `delete-at-nango-${orphan.integration}-${orphan.nangoConnectionId}`;
    const { deleted } = await runStep(id, () => deleteOrphan(orphan));
    if (deleted) summary.deletedAtNango.push(orphan);
  }
  return summary;
}

// Both sides, and what to do about them: Mycel's connections Nango didn't list, and Nango's
// with no connection, which are held when there are too many of them.
async function readBothSides(now: Date) {
  // Ours first, then Nango's. A connection Nango lists that we didn't read was made after our
  // read, so its attempt was still pending then: each org's attempts are read before its rows,
  // and recording a connection inserts its row before settling its attempt.
  const { ours, pendingAttemptIds } = await readOurs(new Date(now.getTime() - DAY_MS));
  const listed = (await listNangoConnections()).map(refOf);
  const listedKeys = new Set(listed.map(keyOf));
  const ourKeys = new Set(ours.map((c) => keyOf(c.nango)));
  const missing = ours.filter((c) => !listedKeys.has(keyOf(c.nango)));
  const orphans = listed.filter(
    (c) => !ourKeys.has(keyOf(c)) && !pendingAttemptIds.has(c.attemptId ?? ""),
  );
  const held = orphans.length > BULK_DELETE_AT_NANGO_LIMIT && orphans.length * 2 > listed.length;
  if (held) {
    console.error(
      `Reconciliation held ${String(orphans.length)} of Nango's ${String(listed.length)} connections: none has a Mycel connection.`,
    );
  }
  return { missing, orphans: orphans.map(withoutAttempt), held };
}

// One of Mycel's connections Nango didn't list: deleted inside its org once Nango confirms it's
// gone, with everything derived from it.
async function confirmGone({ orgId, connectionId, nango }: OurConnection) {
  if (!(await goneAtNango(nango))) return { deleted: false };
  await forOrg(systemCtx(orgId)).delete(connections, eq(connections.id, connectionId));
  return { deleted: true };
}

// One of Nango's connections with no Mycel connection, deleted at Nango.
async function deleteOrphan(orphan: NangoConnectionRef) {
  try {
    await deleteNangoConnection(orphan.nangoConnectionId, orphan.integration);
    return { deleted: true };
  } catch (error) {
    // Nango failed: the next run tries again. Anything else is a bug, and stops this run.
    if (!(error instanceof NangoRequestError)) throw error;
    console.warn(`Deleting orphan Nango connection ${orphan.nangoConnectionId} failed.`, error);
    return { deleted: false };
  }
}

// Every org's connections, and the IDs of its connect attempts still pending since `since`.
async function readOurs(since: Date) {
  const ours: OurConnection[] = [];
  const pendingAttemptIds = new Set<string>();
  for (const orgId of await listOrgIds()) {
    const db = forOrg(systemCtx(orgId));
    const attempts = await db.select(connectAttempts, {
      where: and(eq(connectAttempts.status, "pending"), gt(connectAttempts.createdAt, since)),
    });
    for (const attempt of attempts) pendingAttemptIds.add(attempt.id);
    for (const row of await db.select(connections)) {
      ours.push({
        orgId,
        connectionId: row.id,
        nango: { nangoConnectionId: row.nangoConnectionId, integration: integrationOf(row.source) },
      });
    }
  }
  return { ours, pendingAttemptIds };
}

// A listing can miss a connection (an outage, a wrong key, a paging fault), so a row is
// deleted only when Nango, asked about that one connection, answers that it has none.
async function goneAtNango(ref: NangoConnectionRef): Promise<boolean> {
  try {
    return !(await nangoConnectionExists(ref.nangoConnectionId, ref.integration));
  } catch (error) {
    if (!(error instanceof NangoRequestError)) throw error;
    console.warn(`Couldn't confirm Nango connection ${ref.nangoConnectionId} is gone.`, error);
    return false;
  }
}

// Tags are hints: only the attempt ID is read from them, to spare a connection whose attempt
// may still record it. Which org a tag names decides nothing.
function refOf(connection: ListedNangoConnection) {
  return {
    nangoConnectionId: connection.connectionId,
    integration: connection.integration,
    attemptId: connection.tags[ATTEMPT_TAGS.attempt],
  };
}

function withoutAttempt(ref: ReturnType<typeof refOf>): NangoConnectionRef {
  return { nangoConnectionId: ref.nangoConnectionId, integration: ref.integration };
}
