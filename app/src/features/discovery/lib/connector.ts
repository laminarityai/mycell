// The connector interface: everything source-specific sits behind it, so nothing outside a
// connector knows about Gmail or Drive (or, later, Outlook).
import type { z } from "zod";
import type { AttachmentMeta, Direction, EventType, ObjectRefKind } from "../types";
import type { GmailPushConfig } from "./gmail-push";

/**
 * Calls to one connection's source API, through the Nango proxy. Null: no such item. A POST
 * isn't retried (connections' `proxyPost`).
 */
export type SourceClient = {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T | null>;
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T | null>;
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
  direction: Direction | null;
  threadId: string | null;
  attachments: AttachmentMeta[];
  labelIds: string[];
  mimeType: string | null;
  objectRefs: { kind: ObjectRefKind; key: string }[];
};

/** One page of a backfill, and the token for the next one (null on the last page). */
export type BackfillPage = { events: NormalizedEvent[]; nextPageToken: string | null };

/** What a poll found since a cursor, and where the next poll starts. */
export type PollResult =
  | {
      events: NormalizedEvent[];
      // The items gone from the account since the cursor, in the order they went: Gmail
      // messages deleted or trashed (by message ID), Drive files deleted, trashed or no longer
      // shared with it (by file ID).
      removed: string[];
      nextCursor: string;
    }
  // The source no longer knows the cursor (it expired): backfill from the last stored event.
  | { cursorExpired: true };

export type Connector = {
  /** Where polling will start: read before backfilling, so nothing arriving meanwhile is lost. */
  readStartCursor(client: SourceClient): Promise<string>;
  /** One page of the items that occurred since `since`, starting at `pageToken`. */
  backfillPage(client: SourceClient, since: Date, pageToken: string | null): Promise<BackfillPage>;
  /** Everything new, and every item removed, since `cursor`. */
  poll(client: SourceClient, cursor: string): Promise<PollResult>;
  /**
   * Starts the app's watch on the account, or renews it (ADR-0026), with the environment's push
   * settings: the app then tells Mycel when something changes. Returns when the watch runs out.
   * Only an app that can notify has one; Drive's will take its own settings.
   */
  watch?(client: SourceClient, push: GmailPushConfig): Promise<Date>;
};
