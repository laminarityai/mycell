// Where an app files an item, for exclusions: a Gmail message's labels (each mailbox has its own
// label IDs, so they're matched by name) and a Drive doc's folders (its parents, and theirs, up
// to the root). Read through the Nango proxy, a source client a step; nothing here is stored.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { FILES } from "@/features/connections/drive";
import { GMAIL, labelNamed, labelsSchema, messageListSchema } from "@/features/connections/gmail";
import { sourceClient } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { driveVersion } from "./drive";
import { sourceRecords } from "./schema";

// How far up a doc's folders are followed: well past any real nesting.
const MAX_FOLDER_DEPTH = 25;

const parentsSchema = z.object({ parents: z.array(z.string()).default([]) });

/** The names, lowercased, of the mailbox's labels among `labelIds`. */
export async function labelNames(source: SourceClient, labelIds: string[]): Promise<Set<string>> {
  const labels = (await source.get(`${GMAIL}/labels`, labelsSchema))?.labels;
  return new Set(
    (labels ?? [])
      .filter((label) => labelIds.includes(label.id))
      .map((label) => label.name.toLowerCase()),
  );
}

/** The IDs of the connection's source records for emails with the label `name` now. */
export async function labelledRecords(
  ctx: Ctx,
  connectionId: string,
  name: string,
): Promise<string[]> {
  const db = forOrg(ctx);
  const learned = await db.count(
    sourceRecords,
    and(eq(sourceRecords.connectionId, connectionId), eq(sourceRecords.app, "gmail")),
  );
  if (learned === 0) return [];
  const source = await sourceClient(ctx, connectionId);
  const labels = await source.get(`${GMAIL}/labels`, labelsSchema);
  const label = labelNamed(labels?.labels ?? [], name);
  if (label === undefined) return [];
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      labelIds: label.id,
      maxResults: "500",
      includeSpamTrash: "true",
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    const page = await source.get(`${GMAIL}/messages?${query}`, messageListSchema);
    if (page === null || page.messages.length === 0) break;
    const records = await db.select(sourceRecords, {
      columns: ["id"],
      where: and(
        eq(sourceRecords.connectionId, connectionId),
        eq(sourceRecords.app, "gmail"),
        inArray(
          sourceRecords.sourceRef,
          page.messages.map((message) => message.id),
        ),
      ),
    });
    ids.push(...records.map((record) => record.id));
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return ids;
}

/** Whether a file with `parentIds` is in one of `folderIds`, or a folder under one. */
export async function inFolders(
  source: SourceClient,
  parentIds: string[],
  folderIds: string[],
): Promise<boolean> {
  const wanted = new Set(folderIds);
  const seen = new Set<string>();
  let level = parentIds;
  for (let depth = 0; depth < MAX_FOLDER_DEPTH && level.length > 0; depth += 1) {
    if (level.some((id) => wanted.has(id))) return true;
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(...(await parentsOf(source, id)));
    }
    level = next;
  }
  return false;
}

/** The IDs of the connection's source records for docs in the folder, or under it, now. */
export async function folderedRecords(
  ctx: Ctx,
  connectionId: string,
  folderId: string,
): Promise<string[]> {
  const records = await forOrg(ctx).select(sourceRecords, {
    columns: ["id", "sourceRef"],
    where: and(eq(sourceRecords.connectionId, connectionId), eq(sourceRecords.app, "drive")),
  });
  if (records.length === 0) return [];
  const source = await sourceClient(ctx, connectionId);
  const ids: string[] = [];
  const byFile = Map.groupBy(records, (record) => driveVersion(record.sourceRef).fileId);
  for (const [fileId, versions] of byFile) {
    const parents = await parentsOf(source, fileId);
    if (await inFolders(source, parents, [folderId])) {
      ids.push(...versions.map((record) => record.id));
    }
  }
  return ids;
}

// A Drive file's (or folder's) parents; none for one the account can't see.
async function parentsOf(source: SourceClient, fileId: string): Promise<string[]> {
  const path = `${FILES}/${encodeURIComponent(fileId)}?fields=parents`;
  return (await source.get(path, parentsSchema))?.parents ?? [];
}
