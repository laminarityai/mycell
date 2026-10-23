// The credit ledger (ADR-0010): one row per grant or model call. The balance is the sum of
// `amount`. Usage rows stay when a workflow, run or connection goes: they are the org's bill.
import "server-only";
import { boolean, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    // The gateway's reported cost in US dollars; 0 for a failed call, whose cost the gateway
    // only reports later under its generation ID (reconciled in M7).
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
  ],
);
