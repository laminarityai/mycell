// Runtime's tables. model_roles holds an org's own choice of model for a model role; a role with
// no row uses the global default from config (invariant 6). runs and run_steps record what each
// run did: derived data only, never message content or generated text (invariant 8). Both
// cascade from their connection (invariant 3).
import {
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
// Runs reference the connection they act on and the version they run: derived data cascades
// from its connection (docs/conventions.md).
import { connections } from "@/features/connections/lib/schema";
import { modelRoleSchema, stepTypes, type ModelRole, type StepType } from "@/features/spec/types";
import { enablements, workflowVersions } from "@/features/workflows/lib/schema";
import { runStatuses, runStepStatuses, type Json } from "../types";

const modelRoleEnum = modelRoleSchema.options as [ModelRole, ...ModelRole[]];

export const modelRoles = pgTable(
  "model_roles",
  {
    orgId: text("org_id").notNull(),
    role: text("role", { enum: modelRoleEnum }).notNull(),
    // A gateway `provider/model` ID.
    modelId: text("model_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.role] })],
);

/** One run of a pinned workflow version on one triggering message. */
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    // The connection's kind: a member connection's runs are member-scoped.
    ownerScope: text("owner_scope", { enum: ["member", "org"] }).notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersionId: text("workflow_version_id").notNull(),
    // What started it: an admin by hand, a member workflow's enablement, or an org workflow's
    // switch. A triggered run goes on only while what started it is still on.
    startedBy: text("started_by", { enum: ["manual", "enablement", "org_switch"] })
      .notNull()
      .default("manual"),
    // The enablement that started it. Null for an org workflow or a manual run, and once the
    // enablement is switched off.
    enablementId: text("enablement_id"),
    // The triggering item's ID: a Gmail message's, or a calendar event's.
    sourceRef: text("source_ref").notNull(),
    // A triggered run's (enablement or org workflow, source_ref), so one message starts at most
    // one run of each. Null for a manual run, which may be repeated.
    triggerKey: text("trigger_key"),
    status: text("status", { enum: runStatuses }).notNull(),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("runs_org_id_id_unique").on(table.orgId, table.id),
    unique("runs_org_id_trigger_key_unique").on(table.orgId, table.triggerKey),
    index("runs_org_id_workflow_id_idx").on(table.orgId, table.workflowId),
    // On the enablement's ID alone, so switching off nulls it and the run's row stays: the run
    // then ends `cancelled` before its next step.
    foreignKey({
      name: "runs_enablement_fk",
      columns: [table.enablementId],
      foreignColumns: [enablements.id],
    }).onDelete("set null"),
    foreignKey({
      name: "runs_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "runs_workflow_version_fk",
      columns: [table.orgId, table.workflowVersionId],
      foreignColumns: [workflowVersions.orgId, workflowVersions.id],
    }).onDelete("cascade"),
  ],
);

/** One spec step of a run, recorded once it ends. */
export const runSteps = pgTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    runId: text("run_id").notNull(),
    // Its position in the spec, for ordering.
    position: integer("position").notNull(),
    stepId: text("step_id").notNull(),
    type: text("type", { enum: stepTypes as [StepType, ...StepType[]] }).notNull(),
    status: text("status", { enum: runStepStatuses }).notNull(),
    attempts: integer("attempts").notNull(),
    // When the step's last attempt began.
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    // Labels, probabilities, IDs, counts and field names; never content (ADR-0012). Null when
    // the step failed or has nothing to show.
    output: jsonb("output").$type<Json>(),
    // Built from codes and field names only.
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    modelRole: text("model_role", { enum: modelRoleEnum }),
    modelId: text("model_id"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // A step replayed after a crash records nothing twice.
    unique("run_steps_run_id_step_id_unique").on(table.runId, table.stepId),
    foreignKey({
      name: "run_steps_run_fk",
      columns: [table.orgId, table.runId],
      foreignColumns: [runs.orgId, runs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "run_steps_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Where a trigger that polls its app resumes on one connection: for the Calendar trigger, the
 * sync token of the connection's primary calendar. Only the token is kept, never the events it
 * listed (invariant 8), and it cascades from its connection (invariant 3).
 */
export const triggerCursors = pgTable(
  "trigger_cursors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    trigger: text("trigger", { enum: ["calendar.invite_received"] }).notNull(),
    cursor: text("cursor").notNull(),
    // When the poll that stored the cursor finished.
    polledAt: timestamp("polled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("trigger_cursors_connection_id_trigger_unique").on(table.connectionId, table.trigger),
    foreignKey({
      name: "trigger_cursors_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
  ],
);
