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
// A held send names its review, which it goes with.
import { reviews } from "@/features/reviews/lib/schema";
// A held send names the custom action it calls.
import { customActions } from "@/features/custom-actions/lib/schema";
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
    // The triggering Gmail message's ID.
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
    // Labels, probabilities, IDs, field names, and a tool result's field kinds and sizes; never
    // content, which only the step state carries (ADR-0021). Null when the step failed or has
    // nothing to show.
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
 * A held send (ADR-0020): the request a custom write would make, which Mycel holds until a
 * person approves it, since its app has no way to hold it. `request` is the rendered request
 * and its inputs, encrypted with the company's own key (ADR-0024): nothing else from it is
 * stored. It goes the moment its review ends, whatever the outcome, and after 30 days at most;
 * with the connection it would be sent through (invariant 3), and with its run, so with the
 * run's own connection too, and with its review. Its review points at it by its ID (the review's
 * item ref), and it at its review once its approval step has recorded one.
 */
export const heldSends = pgTable(
  "held_sends",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // The run owner's connection to the custom action's app, which sends it once approved.
    connectionId: text("connection_id").notNull(),
    runId: text("run_id").notNull(),
    // The tool step that made it: one per run step, however often the step is retried.
    stepId: text("step_id").notNull(),
    // The custom action it calls, which never changes once accepted.
    customAction: text("custom_action").notNull(),
    // The run's provenance (invariant 2): the message that started it, and whether it was a
    // member connection's run or an org connection's.
    sourceRef: text("source_ref").notNull(),
    ownerScope: text("owner_scope", { enum: ["member", "org"] }).notNull(),
    // The review that waits on it; null until the run's approval step records one, and for one
    // whose run stopped before then.
    reviewId: text("review_id"),
    // `v1.<encrypted data key>.<iv>.<tag>.<ciphertext>` (key-store's envelope).
    request: text("request").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("held_sends_org_id_run_id_step_id_unique").on(table.orgId, table.runId, table.stepId),
    index("held_sends_org_id_created_at_idx").on(table.orgId, table.createdAt),
    foreignKey({
      name: "held_sends_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "held_sends_run_fk",
      columns: [table.orgId, table.runId],
      foreignColumns: [runs.orgId, runs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "held_sends_review_fk",
      columns: [table.orgId, table.reviewId],
      foreignColumns: [reviews.orgId, reviews.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "held_sends_custom_action_fk",
      columns: [table.orgId, table.customAction],
      foreignColumns: [customActions.orgId, customActions.name],
    }).onDelete("cascade"),
  ],
);
