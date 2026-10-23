// The orgs feature's own table: who an admin removed from the org. Better Auth's tables,
// which hold the org and its members, are in src/db/auth-schema.ts.
import "server-only";
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organization } from "@/db/auth-schema";

/**
 * A removal: the person an admin took out of the org, kept so they can't join it again by
 * signing in (ADR-0002's auto-join) until an admin re-adds them, which deletes the row. No
 * foreign key to the user: the row outlives their user row, since a Google account deleted and
 * re-created under the same address is still refused by that address.
 */
export const removedUsers = pgTable(
  "removed_users",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Normalized (trimmed and lowercased), so sign-in matches it whatever case Google gives.
    email: text("email").notNull(),
    // The admin's user ID.
    removedBy: text("removed_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("removed_users_org_id_user_id_unique").on(table.orgId, table.userId),
    index("removed_users_org_id_email_idx").on(table.orgId, table.email),
  ],
);
