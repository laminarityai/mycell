// A builder proposal stored before specs had paths, written straight to the database: proposing
// now always stores the current spec version, so a v1 proposal can only be made this way.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

/** A v1 spec, as raw JSON the way the table holds it. */
type RawSpec = { specVersion: 1; id: string; [field: string]: unknown };

export async function seedV1Proposal(input: {
  orgId: string;
  conversationId: string;
  workflowId: string;
  name: string;
  /** The working spec's revision and the spec itself when it was proposed. */
  baseRevision: number;
  baseSpec: RawSpec;
  /** The proposed spec, as `validateSpec` parsed it back then. */
  spec: RawSpec;
  maxRisk: string;
}): Promise<{ proposalId: string }> {
  const proposalId = randomUUID();
  await getDb().execute(sql`
    insert into builder_proposals
      (id, org_id, conversation_id, workflow_id, base_revision, base_spec, spec, name, summary,
       max_risk, inserted)
    values (${proposalId}, ${input.orgId}, ${input.conversationId}, ${input.workflowId},
      ${input.baseRevision}, ${JSON.stringify(input.baseSpec)}::jsonb,
      ${JSON.stringify(input.spec)}::jsonb, ${input.name}, 'A change from before paths.',
      ${input.maxRisk}, '[]'::jsonb)
  `);
  return { proposalId };
}
