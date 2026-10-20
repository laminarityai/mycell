// Runtime's tables. model_roles holds an org's own choice of model for a model role; a role with
// no row uses the global default from config (invariant 6).
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { modelRoleSchema, type ModelRole } from "@/features/spec/types";

export const modelRoles = pgTable(
  "model_roles",
  {
    orgId: text("org_id").notNull(),
    role: text("role", { enum: modelRoleSchema.options as [ModelRole, ...ModelRole[]] }).notNull(),
    // A gateway `provider/model` ID.
    modelId: text("model_id").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.role] })],
);
