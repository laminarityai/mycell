import { z } from "zod";
import type { IngestedApp } from "@/features/connections/types";

/** The kinds of object an object ref points at, matched on exact keys (ADR-0008). */
export const objectRefKindSchema = z.enum(["email", "drive_file"]);
export type ObjectRefKind = z.infer<typeof objectRefKindSchema>;

/** What Mycel keeps about an attachment: never its name or content. */
export type AttachmentMeta = {
  mimeType: string;
  size: number;
  // The Drive file behind it, when the source says which.
  driveFileId: string | null;
};

export const EVENT_TYPES = [
  "email.received",
  "email.sent",
  "file.created",
  "file.modified",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Which way an email went. A file change has none. */
export type Direction = "inbound" | "outbound";

/**
 * One event as later stages read it: provenance and shape, never content. `sourceRef` is how
 * the content is re-fetched through the connection.
 */
export type IngestedEvent = {
  id: string;
  connectionId: string;
  ownerScope: "member" | "org";
  // The app the event came from: one Google connection ingests from several.
  source: IngestedApp;
  sourceRef: string;
  type: EventType;
  occurredAt: Date;
  actor: string | null;
  counterparties: string[];
  direction: Direction | null;
  threadId: string | null;
  attachments: AttachmentMeta[];
  labelIds: string[];
  // A Drive file's MIME type; null for an email (its attachments carry their own).
  mimeType: string | null;
};

/** How a backfill ended: it finished, or its connection was deleted while it ran. */
export type BackfillOutcome = { outcome: "done"; items: number } | { outcome: "gone" };

/**
 * How a poll ended: it stored what was new (`items` messages or file changes read), or the cursor had expired
 * and it backfilled from the last stored event instead, or the connection isn't `active` and
 * was skipped, or it was deleted while the poll ran.
 */
export type PollOutcome =
  | { outcome: "polled"; items: number }
  | { outcome: "recovered"; items: number }
  | { outcome: "skipped" }
  | { outcome: "gone" };

/** One connection the polling cron fans out a poll to, with the org its job acts in. */
export type ConnectionToPoll = { orgId: string; connectionId: string };

/**
 * An item discovery stored, as `discovery/item.stored` points at it: each Gmail message but
 * drafts, and each Drive file version. `sourceRef` is how it's re-fetched.
 */
export type StoredItem = {
  connectionId: string;
  app: "gmail" | "drive";
  sourceRef: string;
  occurredAt: Date;
};

/** Which stored items to count or list: all, or only Drive files of `driveMimeType`. */
export type StoredItemsQuery = { driveMimeType?: string };

/** One page of stored items; `next` names the page after it, or is null after the last. */
export type StoredItemsPage = { items: StoredItem[]; next: string | null };
