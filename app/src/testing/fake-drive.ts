// A fake Google Drive, served through the fake Nango's proxy. It answers the Drive API v3 calls
// Mycel makes (about.get, changes.getStartPageToken, files.list, changes.list) in the shapes
// Google documents, from files a test seeds. Every file has a name, and responses carry only
// the `fields` a request asks for, as Drive's do; asking for a file's name fails the test.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import { parseFields, project } from "./fake-drive-fields";

/** A file to seed, described the way a test thinks about it. */
export type FakeFileInput = {
  name: string;
  mimeType: string;
  at: Date;
  // Who created it, when not the account itself. Owners default to the account.
  by?: string;
  owners?: string[];
  // In a shared drive rather than My Drive, which Mycel doesn't read in M1.
  sharedDrive?: boolean;
};

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
};

// One entry in the changes feed: the file changed at `time`.
type ChangeRecord = { token: number; fileId: string; time: string };

/** Thrown for a page token Drive won't accept; the fake proxy answers it with 400. */
class InvalidPageTokenError extends Error {}

export class FakeDrive {
  private files = new Map<string, DriveFileResource>();
  private changes: ChangeRecord[] = [];
  private lastToken = 100;
  // Tokens below this one are no longer accepted.
  private oldestToken = 0;

  constructor(readonly emailAddress: string) {}

  /** Creates a file, as if it had just been made, and returns it. */
  add(input: FakeFileInput): DriveFileResource {
    const time = input.at.toISOString();
    const by = input.by ?? this.emailAddress;
    const file: DriveFileResource = {
      kind: "drive#file",
      id: `1${randomUUID().replaceAll("-", "")}`,
      name: input.name,
      mimeType: input.mimeType,
      createdTime: time,
      modifiedTime: time,
      trashed: false,
      ...(input.sharedDrive === true ? { driveId: "0AsharedDrive" } : {}),
      lastModifyingUser: user(by, by === this.emailAddress),
      owners: (input.owners ?? [this.emailAddress]).map((o) => user(o, o === this.emailAddress)),
    };
    this.files.set(file.id, file);
    this.record(file.id, time);
    return file;
  }

  /** Someone (the account, by default) edits the file at `at`. */
  modify(id: string, at: Date, by = this.emailAddress): void {
    const file = this.file(id);
    file.modifiedTime = at.toISOString();
    file.lastModifyingUser = user(by, by === this.emailAddress);
    this.record(id, file.modifiedTime);
  }

  /** The file goes to the trash: still a file, and a change. */
  trash(id: string, at: Date): void {
    this.file(id).trashed = true;
    this.record(id, at.toISOString());
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
      files: matching.slice(offset, offset + pageSize),
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
    const all = [...latest.values()].filter((c) => this.visible(this.file(c.fileId), params));
    const pageSize = Math.min(Number(params.get("pageSize") ?? 100), 1000);
    const page = all.slice(0, pageSize);
    const rest = all.at(pageSize);
    const body = {
      kind: "drive#changeList",
      changes: page.map((change) => ({
        kind: "drive#change",
        changeType: "file",
        time: change.time,
        removed: false,
        fileId: change.fileId,
        file: this.file(change.fileId),
      })),
      ...(rest === undefined
        ? { newStartPageToken: String(this.lastToken + 1) }
        : { nextPageToken: String(rest.token) }),
    };
    return project(body, fileFields(params));
  }

  // Shared drives' files show only to requests that ask for all drives.
  private visible(file: DriveFileResource, params: URLSearchParams): boolean {
    return file.driveId === undefined || params.get("includeItemsFromAllDrives") === "true";
  }

  private record(fileId: string, time: string): void {
    this.lastToken += 1;
    this.changes.push({ token: this.lastToken, fileId, time });
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

// An error as Drive returns it: a bad page token is a 400 blaming the `pageToken` parameter.
export function driveError(code: 400 | 429) {
  const detail =
    code === 400
      ? {
          domain: "global",
          reason: "invalid",
          message: "Invalid Value",
          locationType: "parameter",
          location: "pageToken",
        }
      : {
          domain: "usageLimits",
          reason: "userRateLimitExceeded",
          message: "User rate limit exceeded.",
        };
  return HttpResponse.json(
    { error: { code, message: detail.message, errors: [detail] } },
    { status: code },
  );
}
