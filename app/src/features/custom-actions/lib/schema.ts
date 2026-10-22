// A company's custom actions (ADR-0018). Tenant-owned, and never updated: a changed action is a
// new row with a new name, so a workflow version that names one never changes under its members.
// No connection_id: a custom action describes a call, holds nothing from any account, and outlives
// the connections it runs through.
import { jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { RiskLevel } from "@/features/policy/types";
import type { CustomActionDescription } from "../types";

export const customActions = pgTable(
  "custom_actions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // Unique in the org; workflow versions name it, as they name catalog actions.
    name: text("name").notNull(),
    // The registered app it calls.
    app: text("app").notNull(),
    // The checked description, without any level the builder proposed.
    description: jsonb("description").$type<CustomActionDescription>().notNull(),
    // The level the fixed rule set when it was accepted.
    risk: text("risk", {
      enum: ["read", "internal_reversible", "external_send", "financial", "destructive"],
    })
      .$type<RiskLevel>()
      .notNull(),
    // The admin who accepted it, a plain user ID, like a workflow's creator.
    acceptedBy: text("accepted_by").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    // The builder proposal it was accepted with; a plain ID, since the action outlives it.
    proposalId: text("proposal_id"),
  },
  (table) => [unique("custom_actions_org_id_name_unique").on(table.orgId, table.name)],
);
