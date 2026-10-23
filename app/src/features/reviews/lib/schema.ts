// Reviews: one row per item a run left waiting for a person in its app's pending form
// (ADR-0013). Pointers only: never the message, the draft or an edit (invariant 8). A review
// goes with its connection and its run's (invariant 3), and with its owner's membership.
import "server-only";
import { foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { member } from "@/db/auth-schema";
import { zodJsonb } from "@/db/columns";
import { pendingDetailsSchema } from "@/features/runtime/types";
import { connections } from "@/features/connections/lib/schema";
import { reviewKinds, reviewStatuses } from "../types";

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    connectionId: text("connection_id").notNull(),
    // The run's own connection, which source_ref came from: connection_id itself, but for a
    // held send, whose review is on the run owner's connection to the custom action's app.
    runConnectionId: text("run_connection_id").notNull(),
    // The run that prepared the item, and the workflow version it ran. Plain IDs: a review
    // outlives nothing it points at except its connections and its owner.
    runId: text("run_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersionId: text("workflow_version_id").notNull(),
    kind: text("kind", { enum: reviewKinds }).notNull(),
    // `member` for a member connection's run, whose owner alone sees it (ADR-0001); `org` for an
    // org connection's.
    ownerScope: text("owner_scope", { enum: ["member", "org"] }).notNull(),
    // The member connection's owner; null for an org review.
    ownerUserId: text("owner_user_id"),
    // The item in its app (a Gmail draft's ID, or an escalated message's), its thread, and the
    // message that started the run.
    itemRef: text("item_ref").notNull(),
    threadRef: text("thread_ref").notNull(),
    sourceRef: text("source_ref").notNull(),
    // An escalation's reason, from the escalate step in the spec (never the message); null for
    // an approval.
    reason: text("reason"),
    // What approving the item needs that its app doesn't show Mycel: the IDs of the suggestions
    // a step made in a Doc. IDs only, never the suggested text; null for every other kind.
    details: zodJsonb("details", pendingDetailsSchema),
    // The colleague the review was last handed to, who may then see and act on it, and who
    // handed it to them; null until it's handed on. Plain user IDs, like ended_by_user_id: a
    // colleague leaving the org doesn't take the review with them.
    handedToUserId: text("handed_to_user_id"),
    handedByUserId: text("handed_by_user_id"),
    status: text("status", { enum: reviewStatuses }).notNull().default("waiting"),
    // Who ended it (a plain user ID, kept for the counts after they leave), and when. Null while
    // waiting, and for an item done in the app or gone, which nobody ended in Mycel.
    endedByUserId: text("ended_by_user_id"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One review per waiting item of a run: an approval step retried makes no second one, and
    // a run escalates its message once, however many of its steps hand it over.
    unique("reviews_org_id_run_id_item_ref_unique").on(table.orgId, table.runId, table.itemRef),
    unique("reviews_org_id_id_unique").on(table.orgId, table.id),
    index("reviews_org_id_status_idx").on(table.orgId, table.status),
    index("reviews_org_id_connection_id_idx").on(table.orgId, table.connectionId),
    foreignKey({
      name: "reviews_connection_fk",
      columns: [table.orgId, table.connectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    index("reviews_org_id_run_connection_id_idx").on(table.orgId, table.runConnectionId),
    foreignKey({
      name: "reviews_run_connection_fk",
      columns: [table.orgId, table.runConnectionId],
      foreignColumns: [connections.orgId, connections.id],
    }).onDelete("cascade"),
    index("reviews_org_id_owner_user_id_idx").on(table.orgId, table.ownerUserId),
    foreignKey({
      name: "reviews_owner_fk",
      columns: [table.orgId, table.ownerUserId],
      foreignColumns: [member.organizationId, member.userId],
    }).onDelete("cascade"),
  ],
);
