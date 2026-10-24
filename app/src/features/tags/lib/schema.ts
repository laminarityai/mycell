// Tags and who has them. Both tables are tenant-owned; composite foreign keys keep a tag and
// the member it's assigned to in the same org as the assignment.
import "server-only";
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    // A normalized slug (tagNameSchema), so uniqueness is case-insensitive by construction.
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tags_org_id_name_unique").on(table.orgId, table.name),
    unique("tags_org_id_id_unique").on(table.orgId, table.id),
  ],
);

export const tagAssignments = pgTable(
  "tag_assignments",
  {
    orgId: text("org_id").notNull(),
    tagId: text("tag_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.userId] }),
    foreignKey({
      name: "tag_assignments_tag_fk",
      columns: [table.orgId, table.tagId],
      foreignColumns: [tags.orgId, tags.id],
    }).onDelete("cascade"),
    index("tag_assignments_org_id_user_id_idx").on(table.orgId, table.userId),
    // Removing a user deletes their member row, and with it their assignments.
    foreignKey({
      name: "tag_assignments_member_fk",
      columns: [table.orgId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
  ],
);
