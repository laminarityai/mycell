// A run of a workflow's latest version on a connection, still running, written straight to the
// database for the e2e tests: starting a run sends an Inngest event the e2e servers never act
// on. A test then ends it through runtime, as the run job would (`failCrashedRun`).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

export async function seedRunningRun(input: {
  orgId: string;
  workflowId: string;
  connectionId: string;
}): Promise<{ id: string }> {
  const id = randomUUID();
  await getDb().execute(sql`
    insert into runs
      (id, org_id, connection_id, owner_scope, workflow_id, workflow_version_id, started_by,
       source_ref, status)
    select ${id}, ${input.orgId}, c.id, c.kind, ${input.workflowId}, v.id, 'manual',
           ${`e2e-message-${id}`}, 'running'
    from connections c, workflow_versions v
    where c.org_id = ${input.orgId} and c.id = ${input.connectionId}
      and v.org_id = ${input.orgId} and v.workflow_id = ${input.workflowId}
    order by v.number desc
    limit 1
  `);
  return { id };
}
