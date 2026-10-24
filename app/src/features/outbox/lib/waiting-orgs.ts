// The outbox job's one cross-org read (ADR-0027), like `orgs`' listOrgIds (ADR-0009): which orgs
// have events waiting. It reads only org IDs; the job then acts inside each org as its system
// ctx, through forOrg. A lint exception lets this file, alone in its feature, use the raw client.
import { asc, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { WAIT_MS } from "./outbox";
import { outbox } from "./schema";
import { now as clockNow } from "@/lib/time";

/** The IDs of the orgs with an event that has waited more than a minute at `now`. Jobs only. */
export async function listOrgsWithWaitingEvents(now = clockNow()): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ orgId: outbox.orgId })
    .from(outbox)
    .where(lt(outbox.writtenAt, new Date(now.getTime() - WAIT_MS)))
    .orderBy(asc(outbox.orgId));
  return rows.map((row) => row.orgId);
}
