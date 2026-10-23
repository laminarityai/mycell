// The credit ledger (ADR-0010): one row per grant or model call. The balance is the sum of
// `amount`. Usage rows stay when a workflow, run or connection goes: they are the org's bill.
import "server-only";
import {
  boolean,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { modelRoleSchema, type ModelRole } from "@/features/spec/types";
import { CREDIT_PURPOSES } from "../types";

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind", { enum: ["grant", "usage"] }).notNull(),
    // Credits: positive for a grant, negative (or zero) for usage.
    amount: numeric("amount", { mode: "number" }).notNull(),
    // Usage only: the role the call named, the model it resolved to, and how the call ended. The
    // injection screen names no role: its row has the service as its model.
    role: text("role", { enum: modelRoleSchema.options as [ModelRole, ...ModelRole[]] }),
    modelId: text("model_id"),
    outcome: text("outcome", { enum: ["succeeded", "failed"] }),
    // The gateway's reported cost in US dollars; 0 for a failed call whose answer reported none.
    // The gateway may still have billed it: what it billed is looked up later under its
    // generation ID and recorded as a correction (`corrects_id`).
    costUsd: numeric("cost_usd", { mode: "number" }),
    generationId: text("generation_id"),
    // What the call was for, when a workflow run made it. No foreign keys: usage outlives both.
    workflowId: text("workflow_id"),
    runId: text("run_id"),
    // Made by a dry run ("Try it"), which has no run record.
    dryRun: boolean("dry_run").notNull().default(false),
    // What the usage was spent on when no run or Try it made it: memory's learning, a person's
    // summary, or the builder chat.
    purpose: text("purpose", { enum: CREDIT_PURPOSES }),
    // A correction: the failed call's usage entry whose billed cost this entry records, with the
    // same attribution. At most one per failed call, however often its lookup is retried.
    correctsId: text("corrects_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("credit_ledger_org_id_idx").on(table.orgId),
    // A budget adds up its purpose's spending this month.
    index("credit_ledger_org_id_purpose_created_at_idx").on(
      table.orgId,
      table.purpose,
      table.createdAt,
    ),
    uniqueIndex("credit_ledger_corrects_id_unique").on(table.correctsId),
    foreignKey({
      name: "credit_ledger_corrects_id_fk",
      columns: [table.correctsId],
      foreignColumns: [table.id],
    }),
  ],
);
