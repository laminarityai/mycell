// A workflow saved before specs had paths, written straight to the database: saving now always
// writes the current spec version, so a v1 working spec or workflow version can only be made
// this way. Its counterpart reads a working spec back as stored, before any upgrade on read.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

/** A v1 spec, as raw JSON the way the table holds it. */
type RawSpec = { specVersion: 1; id: string; [field: string]: unknown };

export async function seedV1Workflow(input: {
  orgId: string;
  createdBy: string;
  name?: string;
  /** The working spec, as `validateSpec` parsed it back then. */
  workingSpec: RawSpec;
  /** A published version: the spec after the policy engine, with what it said of it. */
  published?: { spec: RawSpec; maxRisk: string; requiredActions: string[] };
}): Promise<{ workflowId: string; versionId: string | null }> {
  const db = getDb();
  const workflowId = randomUUID();
  await db.execute(sql`
    insert into workflows (id, org_id, name, spec_id, working_spec, created_by)
    values (${workflowId}, ${input.orgId}, ${input.name ?? input.workingSpec.id},
      ${input.workingSpec.id}, ${JSON.stringify(input.workingSpec)}::jsonb, ${input.createdBy})
  `);
  if (input.published === undefined) return { workflowId, versionId: null };
  const versionId = randomUUID();
  const { spec, maxRisk, requiredActions } = input.published;
  await db.execute(sql`
    insert into workflow_versions
      (id, org_id, workflow_id, number, spec, max_risk, required_actions, published_by)
    values (${versionId}, ${input.orgId}, ${workflowId}, 1, ${JSON.stringify(spec)}::jsonb,
      ${maxRisk}, ${JSON.stringify(requiredActions)}::jsonb, ${input.createdBy})
  `);
  return { workflowId, versionId };
}

/** A workflow's working spec as its row holds it. */
export async function storedWorkingSpec(workflowId: string): Promise<unknown> {
  const { rows } = await getDb().execute<{ working_spec: unknown }>(
    sql`select working_spec from workflows where id = ${workflowId}`,
  );
  return rows[0]?.working_spec;
}
