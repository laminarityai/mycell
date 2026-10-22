// A fake Google Drive, served through the fake Nango's proxy. It answers the Drive API v3 calls
// Mycel makes (about.get, changes.getStartPageToken, files.list, changes.list, files.get and
// files.export) in the shapes Google documents, from files a test seeds. Every file has a name,
// and responses carry only the `fields` a request asks for, as Drive's do; asking for a file's
// name fails the test. Each file has a sharing list (its permissions: its owners, and the
// people, groups, domains or anyone it's shared with), which Drive shows only to an account
// that may share the file: an owner, or someone it's shared with as a writer. A test can share
// and unshare a file, and remove it from the account's Drive (deleted, or no longer shared with
// the account), each a change in the feed.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import { parseFields, project } from "./fake-drive-fields";
import { permission, type DrivePermission, type FakeShareInput } from "./fake-drive-sharing";

/** A file to seed, described the way a test thinks about it. */
export type FakeFileInput = {
  // Another account's file shared with this one has the same ID in both Drives.
  id?: string;
  name: string;
  mimeType: string;
  at: Date;
  // Who created it, when not the account itself. Owners default to the account.
  by?: string;
  owners?: string[];
  // In a shared drive rather than My Drive, which Mycel doesn't read in M1.
  sharedDrive?: boolean;
  // A Google Doc's text, as files.export gives it in text/plain.
  text?: string;
  // Who it's shared with, besides its owners.
  sharedWith?: FakeShareInput[];
  // The folders it's in, by ID. A folder is a file too, with its own parents.
  parents?: string[];
};

export type { DrivePermission, FakeShareInput };

const GOOGLE_DOC = "application/vnd.google-apps.document";

const user = (emailAddress: string, me: boolean) => ({
  kind: "drive#user",
  displayName: emailAddress.slice(0, emailAddress.indexOf("@")),
  me,
  permissionId: randomUUID().replaceAll("-", "").slice(0, 20),
  emailAddress,
});

/** A files resource, with the fields Mycel's requests can name. */
export type DriveFileResource = {
  kind: "drive#file";
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  trashed: boolean;
  driveId?: string;
  lastModifyingUser: ReturnType<typeof user>;
  owners: ReturnType<typeof user>[];
  // Shown only to an account that may share the file (see FakeDrive's view).
  permissions?: DrivePermission[];
  parents?: string[];
};

// One entry in the changes feed: the file changed at `time`, or left the account's Drive.
type ChangeRecord = { token: number; fileId: string; time: string; removed: boolean };

/** Thrown for a page token Drive won't accept; the fake proxy answers it with 400. */
class InvalidPageTokenError extends Error {}

export class FakeDrive {
  private files = new Map<string, DriveFileResource>();
  // Files that left the account's Drive, for the changes feed to report.
  private removedFiles = new Map<string, DriveFileResource>();
  private texts = new Map<string, string>();
  private changes: ChangeRecord[] = [];
  private lastToken = 100;
  // Tokens below this one are no longer accepted.
  private oldestToken = 0;

  constructor(readonly emailAddress: string) {}

  /** Creates a file, as if it had just been made, and returns it. */
  add(input: FakeFileInput): DriveFileResource {
    const time = input.at.toISOString();
    const by = input.by ?? this.emailAddress;
    const owners = input.owners ?? [this.emailAddress];
    const file: DriveFileResource = {
      kind: "drive#file",
      id: input.id ?? `1${randomUUID().replaceAll("-", "")}`,
      name: input.name,
      mimeType: input.mimeType,
      createdTime: time,
      modifiedTime: time,
      trashed: false,
      ...(input.sharedDrive === true ? { driveId: "0AsharedDrive" } : {}),
      ...(input.parents === undefined ? {} : { parents: input.parents }),
      lastModifyingUser: user(by, by === this.emailAddress),
      owners: owners.map((o) => user(o, o === this.emailAddress)),
      permissions: [
        ...owners.map((emailAddress) => permission({ type: "user", emailAddress }, "owner")),
        ...(input.sharedWith ?? []).map((share) => permission(share, share.role ?? "reader")),
      ],
    };
    this.files.set(file.id, file);
    this.removedFiles.delete(file.id);
    if (input.text !== undefined) this.texts.set(file.id, input.text);
    this.record(file.id, time);
    return file;
  }

  /** Someone (the account, by default) edits the file at `at`, giving a Doc `text` if any. */
  modify(id: string, at: Date, by = this.emailAddress, text?: string): void {
    const file = this.file(id);
    if (text !== undefined) this.texts.set(id, text);
    file.modifiedTime = at.toISOString();
    file.lastModifyingUser = user(by, by === this.emailAddress);
    this.record(id, file.modifiedTime);
  }

  /** The file goes to the trash: still a file, and a change. */
  trash(id: string, at: Date): void {
    this.file(id).trashed = true;
    this.record(id, at.toISOString());
  }

  /** The file is shared with someone else, without changing its content or modified time. */
  share(id: string, share: FakeShareInput, at = new Date()): void {
    const file = this.file(id);
    file.permissions = [...(file.permissions ?? []), permission(share, share.role ?? "reader")];
    this.record(id, at.toISOString());
  }

  /** The file is no longer shared with `emailAddress`; its content and modified time stay. */
  unshare(id: string, emailAddress: string, at = new Date()): void {
    const file = this.file(id);
    file.permissions = (file.permissions ?? []).filter((p) => p.emailAddress !== emailAddress);
    this.record(id, at.toISOString());
  }

  /**
   * The file leaves the account's Drive: deleted for good, or no longer shared with the account.
   * The changes feed reports it removed, and the account can no longer read it.
   */
  remove(id: string, at = new Date()): void {
    this.removedFiles.set(id, this.file(id));
    this.files.delete(id);
    this.texts.delete(id);
    this.record(id, at.toISOString(), true);
  }

  /** Drive stops accepting every page token handed out so far. */
  expireTokens(): void {
    this.oldestToken = this.lastToken + 1;
  }

  file(id: string): DriveFileResource {
    const file = this.files.get(id);
    if (file === undefined) throw new Error(`The fake Drive has no file ${id}`);
    return file;
  }

  about(params: URLSearchParams) {
    const about = { kind: "drive#about", user: user(this.emailAddress, true) };
    return project(about, parseFields(required(params, "fields")));
  }

  startPageToken() {
    return { kind: "drive#startPageToken", startPageToken: String(this.lastToken + 1) };
  }

  /** files.list over My Drive and files shared with the user (`corpora=user`), newest first. */
  list(params: URLSearchParams) {
    if (params.get("corpora") !== "user") throw new Error("The fake Drive serves corpora=user");
    const after = parseQuery(params.get("q") ?? "");
    const matching = [...this.files.values()]
      .filter((f) => this.visible(f, params) && !f.trashed && Date.parse(f.modifiedTime) > after)
      .sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
    const pageSize = Math.min(Number(params.get("pageSize") ?? 100), 1000);
    const offset = Number(params.get("pageToken") ?? 0);
    const next = offset + pageSize < matching.length ? String(offset + pageSize) : undefined;
    const body = {
      kind: "drive#fileList",
      incompleteSearch: false,
      files: matching.slice(offset, offset + pageSize).map((file) => this.view(file)),
      ...(next === undefined ? {} : { nextPageToken: next }),
    };
    return project(body, fileFields(params));
  }

  /**
   * changes.list from `pageToken`, oldest first, each file once (at its latest change), paged.
   * Throws InvalidPageTokenError for a token Drive no longer accepts.
   */
  listChanges(params: URLSearchParams) {
    const start = Number(required(params, "pageToken"));
    if (!Number.isInteger(start) || start < this.oldestToken || start > this.lastToken + 1) {
      throw new InvalidPageTokenError();
    }
    const latest = new Map<string, ChangeRecord>();
    for (const change of this.changes.filter((c) => c.token >= start)) {
      latest.delete(change.fileId);
      latest.set(change.fileId, change);
    }
    const all = [...latest.values()].filter((c) =>
      this.visible(this.removedFiles.get(c.fileId) ?? this.file(c.fileId), params),
    );
    const pageSize = Math.min(Number(params.get("pageSize") ?? 100), 1000);
    const page = all.slice(0, pageSize);
    const rest = all.at(pageSize);
    const body = {
      kind: "drive#changeList",
      changes: page.map((change) => ({
        kind: "drive#change",
        changeType: "file",
        time: change.time,
        removed: change.removed,
        fileId: change.fileId,
        // A removed file's change has no file.
        ...(change.removed ? {} : { file: this.view(this.file(change.fileId)) }),
      })),
      ...(rest === undefined
        ? { newStartPageToken: String(this.lastToken + 1) }
        : { nextPageToken: String(rest.token) }),
    };
    return project(body, fileFields(params));
  }

  /** files.get: the file's fields the request names, or null if the account has no such file. */
  get(id: string, params: URLSearchParams) {
    if (params.has("alt")) throw new Error("The fake Drive doesn't download files");
    const file = this.files.get(id);
    if (file === undefined || !this.visible(file, params)) return null;
    return project(this.view(file), fileFields(params));
  }

  /**
   * files.export as text/plain: a Google Doc's text, null if the account has no such file, or
   * "not_exportable" for any other kind of file.
   */
  export(id: string, params: URLSearchParams): { text: string } | null | "not_exportable" {
    if (params.get("mimeType") !== "text/plain") throw new Error("The fake Drive exports text");
    const file = this.files.get(id);
    if (file === undefined || !this.visible(file, params)) return null;
    if (file.mimeType !== GOOGLE_DOC) return "not_exportable";
    return { text: this.texts.get(id) ?? "" };
  }

  // The file as the account sees it: its sharing list only if the account may share the file.
  private view(file: DriveFileResource): DriveFileResource {
    const { permissions, ...rest } = file;
    const mine = (permissions ?? []).filter(
      (p) => p.type === "user" && p.emailAddress === this.emailAddress,
    );
    const canShare = mine.some((p) => p.role === "owner" || p.role === "writer");
    return canShare ? file : rest;
  }

  // Shared drives' files show only to requests that ask for all drives.
  private visible(file: DriveFileResource, params: URLSearchParams): boolean {
    return file.driveId === undefined || params.get("includeItemsFromAllDrives") === "true";
  }

  private record(fileId: string, time: string, removed = false): void {
    this.lastToken += 1;
    this.changes.push({ token: this.lastToken, fileId, time, removed });
  }
}

// A file listing's `fields`. Mycel never asks Drive for a file's name (invariant 8), so a
// request that does fails the test rather than quietly getting one.
function fileFields(params: URLSearchParams) {
  const fields = required(params, "fields");
  if (/\bname\b/.test(fields)) throw new Error(`Mycel asked Drive for file names: ${fields}`);
  return parseFields(fields);
}

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (value === null) throw new Error(`The fake Drive needs ${name}`);
  return value;
}

// The query terms Mycel sends: `modifiedTime > '<RFC 3339>'` and `trashed = false`. Returns the
// modifiedTime bound, in epoch milliseconds.
function parseQuery(q: string): number {
  const terms = q.split(/\s+and\s+/);
  let after = Number.NEGATIVE_INFINITY;
  for (const term of terms) {
    const time = /^modifiedTime > '([^']+)'$/.exec(term)?.[1];
    if (time !== undefined) after = Date.parse(time);
    else if (term !== "trashed = false") throw new Error(`The fake Drive can't query ${term}`);
  }
  return after;
}

// The Drive API behind the proxy, answering from the connection's Drive.
export function driveResponse(drive: FakeDrive, path: string, params: URLSearchParams) {
  if (path === "/drive/v3/about") return HttpResponse.json(drive.about(params));
  if (path === "/drive/v3/changes/startPageToken") {
    return HttpResponse.json(drive.startPageToken());
  }
  if (path === "/drive/v3/files") return HttpResponse.json(drive.list(params));
  const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)?.at(1);
  if (file !== undefined) {
    const found = drive.get(decodeURIComponent(file), params);
    return found === null ? driveError(404) : HttpResponse.json(found);
  }
  const exported = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(path)?.at(1);
  if (exported !== undefined) {
    const answer = drive.export(decodeURIComponent(exported), params);
    if (answer === null) return driveError(404);
    if (answer === "not_exportable") return driveError(403);
    return HttpResponse.text(answer.text);
  }
  if (path === "/drive/v3/changes") {
    try {
      return HttpResponse.json(drive.listChanges(params));
    } catch (error) {
      if (error instanceof InvalidPageTokenError) return driveError(400);
      throw error;
    }
  }
  throw new Error(`The fake Drive doesn't serve ${path}`);
}

// An error as Drive returns it: a bad page token is a 400 blaming the `pageToken` parameter, a
// file the account doesn't have a 404, and exporting a file that isn't a Docs Editors file a 403.
export function driveError(code: 400 | 403 | 404 | 429) {
  const details = {
    400: {
      domain: "global",
      reason: "invalid",
      message: "Invalid Value",
      locationType: "parameter",
      location: "pageToken",
    },
    403: {
      domain: "global",
      reason: "fileNotExportable",
      message: "Export only supports Docs Editors files.",
    },
    404: {
      domain: "global",
      reason: "notFound",
      message: "File not found.",
      locationType: "parameter",
      location: "fileId",
    },
    429: {
      domain: "usageLimits",
      reason: "userRateLimitExceeded",
      message: "User rate limit exceeded.",
    },
  };
  const detail = details[code];
  return HttpResponse.json(
    { error: { code, message: detail.message, errors: [detail] } },
    { status: code },
  );
}
