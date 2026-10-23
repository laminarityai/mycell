// A finished run, written straight to the database, for the e2e tests: starting one sends an
// Inngest event, which the e2e servers don't receive, and executing one is the interpreter's
// business, which Vitest covers. A failed run records its one failed step.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

export async function seedRun(input: {
  orgId: string;
  connectionId: string;
  ownerScope: "member" | "org";
  workflowId: string;
  workflowVersionId: string;
  sourceRef: string;
  status: "succeeded" | "failed";
  /** The step a failed run failed on, with its error. */
  failed?: { stepId: string; type: string; errorCode: string; errorMessage: string };
}): Promise<{ id: string }> {
  const db = getDb();
  const id = randomUUID();
  await db.execute(sql`
    insert into runs
      (id, org_id, connection_id, owner_scope, workflow_id, workflow_version_id, source_ref,
       status, finished_at)
    values
      (${id}, ${input.orgId}, ${input.connectionId}, ${input.ownerScope}, ${input.workflowId},
       ${input.workflowVersionId}, ${input.sourceRef}, ${input.status}, now())
  `);
  if (input.failed !== undefined) {
    const { stepId, type, errorCode, errorMessage } = input.failed;
    await db.execute(sql`
      insert into run_steps
        (id, org_id, connection_id, run_id, position, step_id, type, status, attempts,
         error_code, error_message, started_at, finished_at)
      values
        (${randomUUID()}, ${input.orgId}, ${input.connectionId}, ${id}, 0, ${stepId}, ${type},
         'failed', 1, ${errorCode}, ${errorMessage}, now(), now())
    `);
  }
  return { id };
}
