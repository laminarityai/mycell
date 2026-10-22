// The Drive connector: the changes feed's page token as the cursor, files.list for the backfill,
// and changes.list for polling. Both read the same file fields (never the name) and normalize
// each file the same way. My Drive and files shared with the user only: no shared drives. The
// changes feed also reports files removed: deleted, no longer shared with the account (Drive's
// `removed`), or put in the trash.
import { SourceRequestError } from "@/features/connections/types";
import type { Connector, NormalizedEvent, SourceClient } from "../connector";
import {
  blamesPageToken,
  CHANGED_FILE_FIELDS,
  changeListSchema,
  FILE_FIELDS,
  fileListSchema,
  startPageTokenSchema,
} from "./api";
import { normalizeFile } from "./normalize";

// Files per backfill page, and changes per poll page: Drive's maximum for both. A page needs
// no further request per file, so a page stays well inside one Inngest step.
const PAGE_SIZE = 1000;

export const driveConnector: Connector = {
  async readStartCursor(client) {
    const token = await client.get("/drive/v3/changes/startPageToken", startPageTokenSchema);
    if (token === null) throw new Error("Drive has no start page token for this account");
    return token.startPageToken;
  },

  async backfillPage(client, since, pageToken) {
    const query = new URLSearchParams({
      q: `modifiedTime > '${since.toISOString()}' and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: String(PAGE_SIZE),
      corpora: "user",
      includeItemsFromAllDrives: "false",
    });
    if (pageToken !== null) query.set("pageToken", pageToken);
    const list = await client.get(`/drive/v3/files?${query.toString()}`, fileListSchema);
    return {
      events: (list?.files ?? []).map(normalizeFile).filter((event) => event.occurredAt >= since),
      nextPageToken: list?.nextPageToken ?? null,
    };
  },

  async poll(client, cursor) {
    const found = new Map<string, NormalizedEvent>();
    const removed = new Set<string>();
    let pageToken = cursor;
    for (;;) {
      const page = await changesPage(client, pageToken);
      if (page === "expired") return { cursorExpired: true };
      for (const change of page.changes ?? []) {
        // A change to a shared drive itself.
        if (change.changeType !== "file") continue;
        const fileId = change.fileId ?? change.file?.id;
        const file = change.removed === true ? undefined : change.file;
        if (file === undefined || file.trashed === true) {
          if (fileId === undefined) continue;
          removed.add(fileId);
          // Gone after a change earlier in the feed: none of its versions is stored.
          for (const ref of found.keys()) if (ref.startsWith(`${fileId}@`)) found.delete(ref);
          continue;
        }
        // Back in the account's Drive after a removal earlier in the feed.
        removed.delete(file.id);
        const event = normalizeFile(file);
        found.set(event.sourceRef, event);
      }
      if (page.nextPageToken !== undefined) {
        pageToken = page.nextPageToken;
        continue;
      }
      if (page.newStartPageToken === undefined) {
        throw new Error("Drive's last changes page had no newStartPageToken");
      }
      // The last page's token: the next poll starts where this one ended.
      return {
        events: [...found.values()],
        removed: [...removed],
        nextCursor: page.newStartPageToken,
      };
    }
  },
};

// One page of the changes feed, or "expired" when Drive no longer accepts the token: it answers
// 400 blaming `pageToken` (or 404 / 410, which the client reads as null).
async function changesPage(client: SourceClient, pageToken: string) {
  const query = new URLSearchParams({
    pageToken,
    fields: `nextPageToken, newStartPageToken, changes(changeType, removed, fileId, file(${CHANGED_FILE_FIELDS}))`,
    pageSize: String(PAGE_SIZE),
    spaces: "drive",
    includeItemsFromAllDrives: "false",
  });
  try {
    const page = await client.get(`/drive/v3/changes?${query.toString()}`, changeListSchema);
    return page ?? "expired";
  } catch (error) {
    if (
      error instanceof SourceRequestError &&
      error.status === 400 &&
      blamesPageToken(error.body)
    ) {
      return "expired";
    }
    throw error;
  }
}
