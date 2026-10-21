// Workflows, their published versions, and what switches them on. All are tenant-owned. A
// version is immutable: the feature has no update path for it, only inserts.
import { foreignKey, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";
// A switch names the connection it runs on, and goes when the connection does (invariant 3).
import { connections } from "@/features/connections/lib/schema";
import type { RiskLevel } from "@/features/policy/types";
import type { StoredSpec } from "@/features/spec/stored";

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    // The spec's own `id`, unique in the org.
    specId: text("spec_id").notNull(),
    // The working spec, as `validateSpec` parsed it: before the policy engine runs.
    workingSpec: jsonb("working_spec").$type<StoredSpec>().notNull(),
    // Counts the working spec's saves, so a save made from an older one can be refused.
    revision: integer("revision").notNull().default(1),
    // Plain user IDs: a workflow outlives the admin who made it.
    createdBy: text("created_by").notNull(),
    // An org-credential workflow's one switch: the org connection it runs on while it's on, and
    // since when. Null while off. Deleting the connection switches it off.
    orgConnectionId: text("org_connection_id"),
    orgSwitchedOnAt: timestamp("org_switched_on_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("workflows_org_id_spec_id_unique").on(table.orgId, table.specId),
    unique("workflows_org_id_id_unique").on(table.orgId, table.id),
    // On the connection's ID alone, so deleting it can null this column and keep org_id. The
    // switch-on checks the connection is in the workflow's org.
    foreignKey({
      name: "workflows_org_connection_fk",
      columns: [table.orgConnectionId],
      foreignColumns: [connections.id],
    }).onDelete("set null"),
  ],
);

/**
 * An enablement: one admin's switch-on of one member-credential workflow on their own member
 * connection. It follows the workflow's latest version. Switching off deletes it, and so does
 * deleting the connection or removing the user. `status` is only `on` until M5 adds `paused`.
 */
export const enablements = pgTable(
  "enablements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    userId: text("user_id").notNull(),
    connectionId: text("connection_id").notNull(),
    status: text("status", { enum: ["on"] })
      .notNull()
      .default("on"),
    // Written from JS, like the message times it's compared with (no default: the column has
    // no time zone, and the database's now() would be read back hours off).
    enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("enablements_workflow_id_user_id_unique").on(table.workflowId, table.userId),
    unique("enablements_org_id_id_unique").on(table.orgId, table.id),
    foreignKey({
      name: "enablements_workflow_fk",
      columns: [table.orgId, table.workflowId],
      foreignColumns: [workflows.orgId, workflows.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "enablements_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "enablements_member_fk",
      columns: [table.orgId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
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
    spec: jsonb("spec").$type<StoredSpec>().notNull(),
    maxRisk: text("max_risk", {
      enum: ["read", "internal_reversible", "external_send", "financial", "destructive"],
    })
      .$type<RiskLevel>()
      .notNull(),
    requiredActions: jsonb("required_actions").$type<string[]>().notNull(),
    publishedBy: text("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
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
