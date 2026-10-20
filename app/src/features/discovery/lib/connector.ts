// The connector interface: everything source-specific sits behind it, so nothing outside a
// connector knows about Gmail (or, later, Drive or Outlook).
import type { z } from "zod";
import type { AttachmentMeta, EventType, ObjectRefKind } from "../types";

/** GETs against one connection's source API, through the Nango proxy. Null: no such item. */
export type SourceClient = {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T | null>;
};

/**
 * One event as a connector normalizes it, before it's stored. It carries no content: the text
 * an object ref was found in stays inside the connector, in memory.
 */
export type NormalizedEvent = {
  sourceRef: string;
  type: EventType;
  occurredAt: Date;
  actor: string | null;
  counterparties: string[];
  direction: "inbound" | "outbound";
  threadId: string | null;
  attachments: AttachmentMeta[];
  labelIds: string[];
  objectRefs: { kind: ObjectRefKind; key: string }[];
};

/** One page of a backfill, and the token for the next one (null on the last page). */
export type BackfillPage = { events: NormalizedEvent[]; nextPageToken: string | null };

/** What a poll found since a cursor, and where the next poll starts. */
export type PollResult =
  | { events: NormalizedEvent[]; nextCursor: string }
  // The source no longer knows the cursor (it expired): backfill from the last stored event.
  | { cursorExpired: true };

export type Connector = {
  /** Where polling will start: read before backfilling, so nothing arriving meanwhile is lost. */
  readStartCursor(client: SourceClient): Promise<string>;
  /** One page of the items that occurred since `since`, starting at `pageToken`. */
  backfillPage(client: SourceClient, since: Date, pageToken: string | null): Promise<BackfillPage>;
  /** Everything new since `cursor`. */
  poll(client: SourceClient, cursor: string): Promise<PollResult>;
};
