// The connector interface: everything source-specific sits behind it, so nothing outside a
// connector knows about Gmail or Drive (or, later, Outlook).
import type { z } from "zod";
import type { AttachmentMeta, Direction, EventType, ObjectRefKind } from "../types";

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

/** One page of what changed since a poll's cursor. */
export type PollPage =
  | {
      // The items found on the page, normalized, to store at once (Drive's files).
      events: NormalizedEvent[];
      // The items added that must each be read to be normalized (Gmail's messages), by ID.
      added: string[];
      // The items gone from the account, in the order they went: Gmail messages deleted or
      // trashed (by message ID), Drive files deleted, trashed or no longer shared with it (by
      // file ID).
      removed: string[];
      // The next page, null after the last.
      nextPageToken: string | null;
      // Where the next poll starts, when the page says: Gmail's every page says (the first
      // page's is kept), Drive's last page only.
      nextCursor: string | null;
    }
  // The source no longer knows the cursor (it expired): backfill from the last stored event.
  | { cursorExpired: true };

export type Connector = {
  /** Where polling will start: read before backfilling, so nothing arriving meanwhile is lost. */
  readStartCursor(client: SourceClient): Promise<string>;
  /** One page of the items that occurred since `since`, starting at `pageToken`. */
  backfillPage(client: SourceClient, since: Date, pageToken: string | null): Promise<BackfillPage>;
  /**
   * One page of everything new, and every item removed, since `cursor`, from `pageToken` (null
   * for the first page). A poll reads one page per step.
   */
  pollPage(client: SourceClient, cursor: string, pageToken: string | null): Promise<PollPage>;
  /**
   * Reads and normalizes items a poll's pages listed as added, leaving out any gone since or not
   * ingested. Only a connector whose pages list items by ID (Gmail's) has it.
   */
  readAdded?(client: SourceClient, ids: string[]): Promise<NormalizedEvent[]>;
  /** The app's watch (ADR-0026), if it can tell Mycel when something changes. */
  watch?: Watcher;
};

/** A web-hook channel a watch opened (Drive's): what stopping it needs. */
export type WatchChannel = { id: string; resourceId: string };

/** What a watch is for: the connection, in its org, and the app's stored cursor. */
export type WatchTarget = { orgId: string; connectionId: string; cursor: string | null };

/** A watch the app started: when it runs out, and the channel it opened, if it's one. */
export type StartedWatch = { expiresAt: Date; channel: WatchChannel | null };

export type Watcher = {
  /** Whether this environment has the app's push settings. Without them no watch starts. */
  configured(): boolean;
  /**
   * Starts the app's watch on the account, or renews it: the app then tells Mycel when
   * something changes. Only called when `configured()`.
   */
  start(client: SourceClient, target: WatchTarget): Promise<StartedWatch>;
  /**
   * Stops a channel an earlier watch opened, once its replacement is open. Only an app whose
   * watch opens channels has it; a watch that renews in place (Gmail's) needs none.
   */
  stop?(client: SourceClient, channel: WatchChannel): Promise<void>;
};
