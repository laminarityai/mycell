// Turns one Drive file, as files.list or a change shows it, into one event. Drive is never asked
// for the file's name or content, so neither can reach an event.
import type { NormalizedEvent } from "../connector";
import { normalizeKey } from "../object-refs";
import type { DriveFile } from "./api";

export function normalizeFile(file: DriveFile): NormalizedEvent {
  const actor = address(file.lastModifyingUser?.emailAddress);
  const owners = unique(
    (file.owners ?? []).flatMap((owner) => {
      const email = address(owner.emailAddress);
      return email === null ? [] : [email];
    }),
  );
  const created = Date.parse(file.createdTime) === Date.parse(file.modifiedTime);
  return {
    // One event per version: a file changed again is a new event, and the same version read by
    // a backfill and a poll is stored once.
    sourceRef: `${file.id}@${file.modifiedTime}`,
    type: created ? "file.created" : "file.modified",
    occurredAt: new Date(file.modifiedTime),
    actor,
    counterparties: owners.filter((owner) => owner !== actor),
    direction: null,
    threadId: null,
    attachments: [],
    labelIds: [],
    mimeType: file.mimeType,
    objectRefs: [
      { kind: "drive_file", key: normalizeKey("drive_file", file.id) },
      ...unique([...(actor === null ? [] : [actor]), ...owners]).map((key) => ({
        kind: "email" as const,
        key,
      })),
    ],
  };
}

function address(email: string | undefined): string | null {
  return email === undefined || email === "" ? null : normalizeKey("email", email);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
