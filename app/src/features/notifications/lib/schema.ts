// Each person's notification settings: one row per member who changed one, so a missing row
// means every default. The row goes with the person's membership.
import { boolean, foreignKey, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";

export const userSettings = pgTable(
  "user_settings",
  {
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    // The daily email listing the person's waiting reviews. On by default.
    reviewDigest: boolean("review_digest").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    // Removing a user deletes their member row, and with it their settings.
    foreignKey({
      name: "user_settings_member_fk",
      columns: [table.orgId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
  ],
);
