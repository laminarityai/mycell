// Workflows and their published versions. Both are tenant-owned. A version is immutable: the
// feature has no update path for it, only inserts.
import { foreignKey, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { RiskLevel } from "@/features/policy/types";
import type { Spec } from "@/features/spec/types";

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    // The spec's own `id`, unique in the org.
    specId: text("spec_id").notNull(),
    // The working spec, as `validateSpec` parsed it: before the policy engine runs.
    workingSpec: jsonb("working_spec").$type<Spec>().notNull(),
    // Plain user IDs: a workflow outlives the admin who made it.
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("workflows_org_id_spec_id_unique").on(table.orgId, table.specId),
    unique("workflows_org_id_id_unique").on(table.orgId, table.id),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    number: integer("number").notNull(),
    // The spec after `applyPolicy`: inserted approvals included.
    spec: jsonb("spec").$type<Spec>().notNull(),
    maxRisk: text("max_risk", {
      enum: ["read", "internal_reversible", "external_send", "financial", "destructive"],
    })
      .$type<RiskLevel>()
      .notNull(),
    requiredActions: jsonb("required_actions").$type<string[]>().notNull(),
    publishedBy: text("published_by").notNull(),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
  },
  (table) => [
    unique("workflow_versions_workflow_id_number_unique").on(table.workflowId, table.number),
    unique("workflow_versions_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      name: "workflow_versions_workflow_fk",
      columns: [table.orgId, table.workflowId],
      foreignColumns: [workflows.orgId, workflows.id],
    }).onDelete("cascade"),
  ],
);
