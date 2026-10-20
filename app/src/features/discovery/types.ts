import { z } from "zod";

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

export type EventType = "email.received" | "email.sent";

/**
 * One event as later stages read it: provenance and shape, never content. `sourceRef` is how
 * the content is re-fetched through the connection.
 */
export type IngestedEvent = {
  id: string;
  connectionId: string;
  ownerScope: "member" | "org";
  source: "gmail";
  sourceRef: string;
  type: EventType;
  occurredAt: Date;
  actor: string | null;
  counterparties: string[];
  direction: "inbound" | "outbound";
  threadId: string | null;
  attachments: AttachmentMeta[];
  labelIds: string[];
};

/** How a backfill ended: it finished, or its connection was deleted while it ran. */
export type BackfillOutcome = { outcome: "done"; items: number } | { outcome: "gone" };
