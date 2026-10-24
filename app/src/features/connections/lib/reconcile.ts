// The nightly reconciliation: makes deletion certain even when a webhook was missed (Nango
// sends none for bulk deletes). It compares Mycel's connections with Nango's in both
// directions, inside each org as its system ctx (ADR-0009).
import { and, eq, gt } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { NangoRequestError } from "@/lib/errors";
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
 */
export async function reconcileConnections(now = clockNow()): Promise<ReconciliationSummary> {
  // Ours first, then Nango's. A connection Nango lists that we didn't read was made after our
  // read, so its attempt was still pending then: each org's attempts are read before its rows,
  // and recording a connection inserts its row before settling its attempt.
  const { ours, pendingAttemptIds } = await readOurs(new Date(now.getTime() - DAY_MS));
  const listed = (await listNangoConnections()).map(refOf);
  const listedKeys = new Set(listed.map(keyOf));
  const ourKeys = new Set(ours.map((c) => keyOf(c.nango)));

  const summary: ReconciliationSummary = {
    deletedRows: [],
    keptUnconfirmed: [],
    deletedAtNango: [],
    heldAtNango: [],
  };
  for (const connection of ours.filter((c) => !listedKeys.has(keyOf(c.nango)))) {
    const { orgId, connectionId } = connection;
    if (await goneAtNango(connection.nango)) {
      await forOrg(systemCtx(orgId)).delete(connections, eq(connections.id, connectionId));
      summary.deletedRows.push({ orgId, connectionId });
    } else {
      summary.keptUnconfirmed.push({ orgId, connectionId });
    }
  }

  const orphans = listed.filter(
    (c) => !ourKeys.has(keyOf(c)) && !pendingAttemptIds.has(c.attemptId ?? ""),
  );
  if (orphans.length > BULK_DELETE_AT_NANGO_LIMIT && orphans.length * 2 > listed.length) {
    console.error(
      `Reconciliation held ${String(orphans.length)} of Nango's ${String(listed.length)} connections: none has a Mycel connection.`,
    );
    summary.heldAtNango = orphans.map(withoutAttempt);
    return summary;
  }
  for (const orphan of orphans) {
    try {
      await deleteNangoConnection(orphan.nangoConnectionId, orphan.integration);
      summary.deletedAtNango.push(withoutAttempt(orphan));
    } catch (error) {
      // Nango failed: the next run tries again. Anything else is a bug, and stops this run.
      if (!(error instanceof NangoRequestError)) throw error;
      console.warn(`Deleting orphan Nango connection ${orphan.nangoConnectionId} failed.`, error);
    }
  }
  return summary;
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
