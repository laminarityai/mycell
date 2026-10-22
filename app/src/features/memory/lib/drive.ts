// Reading one Drive file version to learn from, through the Nango proxy: its metadata with its
// sharing list (files.get), then, for a Google Doc, its text (files.export as text/plain). Only
// Google Docs are read: other files (Sheets, Slides, PDFs, images, uploaded text) aren't. The
// text is held in memory only (invariant 8), and Drive is never asked for the file's name. A
// file's sharing list is also read on its own, when it may have changed.
//
// Drive shows a file's sharing list only to an account that may share it (an owner, or someone
// it's shared with as a writer). Read by anyone else, a doc has an empty access list, so only
// the people whose own Drive holds it see what it taught.
import { z } from "zod";
import { proxyGet, proxyGetText } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import { getWorkspaceDomain } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import type { AccessEntry, SourceItem } from "./source-item";

const FILES = "/drive/v3/files";

/** The one kind of Drive file memory learns from. */
export const GOOGLE_DOC = "application/vnd.google-apps.document";

// How much of a doc the models read: a long policy or contract's opening sections.
export const MAX_DOC_CHARS = 24_000;

const FIELDS =
  "id, mimeType, modifiedTime, trashed, parents, owners(emailAddress), " +
  "permissions(type, emailAddress, domain, deleted)";

const fileSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string(),
  trashed: z.boolean().optional(),
  parents: z.array(z.string()).optional(),
  owners: z.array(z.object({ emailAddress: z.string().optional() })).optional(),
  permissions: z
    .array(
      z.object({
        type: z.string(),
        emailAddress: z.string().optional(),
        domain: z.string().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .optional(),
});
type Permission = NonNullable<z.infer<typeof fileSchema>["permissions"]>[number];

/** The file and version a Drive `source_ref` names: `<file ID>@<modified time>`. */
export function driveVersion(sourceRef: string): { fileId: string; modifiedAt: Date } {
  const at = sourceRef.indexOf("@");
  return { fileId: sourceRef.slice(0, at), modifiedAt: new Date(sourceRef.slice(at + 1)) };
}

/**
 * The doc at the version `sourceRef` names, or why not: `gone` (deleted, trashed or no longer
 * the account's), `unsupported` (not a Google Doc, or one Drive won't export to this account),
 * or `outdated` (it has changed since, and its newer version is learned on its own).
 */
export async function readDoc(
  ctx: Ctx,
  connectionId: string,
  sourceRef: string,
): Promise<SourceItem | "gone" | "unsupported" | "outdated"> {
  const { fileId, modifiedAt } = driveVersion(sourceRef);
  const path = filePath(fileId);
  const file = await readFile(ctx, connectionId, fileId);
  if (file === "gone") return "gone";
  if (file.mimeType !== GOOGLE_DOC) return "unsupported";
  if (Date.parse(file.modifiedTime) !== modifiedAt.getTime()) return "outdated";
  let text: string | null;
  try {
    text = await proxyGetText(ctx, connectionId, `${path}/export?mimeType=text%2Fplain`);
  } catch (error) {
    // The owner can stop viewers downloading, which stops exports too.
    if (error instanceof SourceRequestError && error.status === 403) return "unsupported";
    throw error;
  }
  if (text === null) return "gone";
  const domain = (await getWorkspaceDomain(ctx)).toLowerCase();
  return {
    kind: "document",
    sourceRef,
    itemKey: fileId,
    occurredAt: modifiedAt,
    access: accessList(file.permissions ?? []),
    parentIds: file.parents ?? [],
    addresses: [],
    // A doc a colleague owns; one in a shared drive has no owner, and counts as from outside.
    fromInside: (file.owners ?? []).some(
      (owner) => owner.emailAddress?.toLowerCase().endsWith(`@${domain}`) === true,
    ),
    senders: [],
    text: text.slice(0, MAX_DOC_CHARS),
  };
}

/**
 * The file's sharing list as an access list, as the connection's account sees it now (empty
 * when it may not share the file), or `gone` when the file is deleted, trashed or no longer the
 * account's.
 */
export async function readAccess(
  ctx: Ctx,
  connectionId: string,
  fileId: string,
): Promise<AccessEntry[] | "gone"> {
  const file = await readFile(ctx, connectionId, fileId);
  return file === "gone" ? "gone" : accessList(file.permissions ?? []);
}

function filePath(fileId: string): string {
  return `${FILES}/${encodeURIComponent(fileId)}`;
}

// The file's metadata and sharing list, never its name.
async function readFile(ctx: Ctx, connectionId: string, fileId: string) {
  const file = await proxyGet(
    ctx,
    connectionId,
    `${filePath(fileId)}?${new URLSearchParams({ fields: FIELDS }).toString()}`,
    fileSchema,
  );
  return file === null || file.trashed === true ? "gone" : file;
}

// The sharing list as an access list: people and groups by address, domains, and anyone.
function accessList(permissions: Permission[]): AccessEntry[] {
  const entries = new Map<string, AccessEntry>();
  for (const permission of permissions) {
    if (permission.deleted === true) continue;
    const entry = entryOf(permission);
    if (entry !== null) entries.set(`${entry.kind}:${entry.value}`, entry);
  }
  return [...entries.values()];
}

function entryOf(permission: Permission): AccessEntry | null {
  switch (permission.type) {
    case "user":
    case "group":
      return permission.emailAddress
        ? { kind: "address", value: permission.emailAddress.toLowerCase() }
        : null;
    case "domain":
      return permission.domain ? { kind: "domain", value: permission.domain.toLowerCase() } : null;
    case "anyone":
      return { kind: "anyone", value: "" };
    default:
      return null;
  }
}
