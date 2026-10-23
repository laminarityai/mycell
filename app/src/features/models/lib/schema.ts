// The models feature's table. model_roles holds an org's own choice of model for a model role; a
// role with no row uses the global default from config (invariant 6).
import "server-only";
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { modelRoleSchema, type ModelRole } from "@/features/spec/types";

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
