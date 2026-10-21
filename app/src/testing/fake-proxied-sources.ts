// The Google APIs the fake Nango's proxy serves, each by its host and path prefix, answering
// from the connection's own fake (its Gmail mailbox, its Drive or its spreadsheets). Like
// Google, an API answers 403 to a connection whose token holds none of the scopes it accepts
// (for a write, none of the scopes its writes accept), and a host answers 404 for a path it
// doesn't serve.
import { HttpResponse } from "msw";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { driveError, driveResponse } from "./fake-drive";
import { gmailError, gmailResponse, gmailWrite } from "./fake-gmail";
import type { FakeConnection } from "./fake-nango";
import { sheetsError } from "./fake-sheets";

type Respond = (connection: FakeConnection, path: string, params: URLSearchParams) => Response;

/** The verbs the proxy forwards: a GET reads, and the rest write. */
export type ProxyMethod = "GET" | "POST" | "PUT" | "DELETE";
export type WriteMethod = Exclude<ProxyMethod, "GET">;

type RespondToWrite = (
  connection: FakeConnection,
  path: string,
  params: URLSearchParams,
  body: unknown,
  method: WriteMethod,
) => Response;

export type ProxiedSource = {
  host: string;
  prefix: string;
  // Any one of these lets a token call the API.
  scopes: readonly string[];
  respond: Respond;
  // How the API answers a write (POST, PUT or DELETE), and the scopes that let a token write;
  // none for a read-only API.
  write?: { scopes: readonly string[]; respond: RespondToWrite };
  rateLimited: () => Response;
};

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const DRIVE_READONLY = GOOGLE_APP_SCOPES.drive;
const DRIVE = "https://www.googleapis.com/auth/drive";
const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const SPREADSHEETS_READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";

export const PROXIED_SOURCES: ProxiedSource[] = [
  {
    host: "https://gmail.googleapis.com",
    prefix: "/gmail/v1/users/me",
    scopes: [GOOGLE_APP_SCOPES.gmail, GMAIL_READONLY, "https://mail.google.com/"],
    respond: (connection, path, params) => gmailResponse(connection.mailbox, path, params),
    write: {
      // Labels, messages.modify and drafts all take gmail.modify; drafts take compose too.
      scopes: [GOOGLE_APP_SCOPES.gmail, GMAIL_COMPOSE, "https://mail.google.com/"],
      respond: (connection, path, _params, body, method) =>
        gmailWrite(connection.mailbox, path, body, method),
    },
    rateLimited: () => gmailError(429, "RESOURCE_EXHAUSTED"),
  },
  {
    host: "https://www.googleapis.com",
    prefix: "/drive/v3",
    scopes: [DRIVE_READONLY, DRIVE],
    respond: (connection, path, params) => driveResponse(connection.drive, path, params),
    rateLimited: () => driveError(429),
  },
  {
    host: "https://sheets.googleapis.com",
    prefix: "/v4/spreadsheets",
    // values.get takes any Drive or Sheets scope; values.append a read-write one.
    scopes: [GOOGLE_APP_SCOPES.sheets, SPREADSHEETS_READONLY, DRIVE, DRIVE_READONLY, DRIVE_FILE],
    respond: (connection, path) => connection.sheets.respond(path),
    write: {
      scopes: [GOOGLE_APP_SCOPES.sheets, DRIVE, DRIVE_FILE],
      respond: (connection, path, params, body, method) => {
        if (method !== "POST") throw new Error(`The fake Sheets takes no ${method}s`);
        return connection.sheets.write(path, params, body);
      },
    },
    rateLimited: () => sheetsError(429, "RESOURCE_EXHAUSTED"),
  },
];

/** The host each Nango integration proxies to when a request names none (Nango's providers). */
export const INTEGRATION_HOSTS: Partial<Record<string, string>> = {
  google: "https://www.googleapis.com",
  "google-mail": "https://gmail.googleapis.com",
  "google-drive": "https://www.googleapis.com",
};

/**
 * What a connection is granted unless a test says otherwise: every app Mycel asks for on the
 * `google` integration, and the one scope each one-app integration asked for before ADR-0014.
 */
export const DEFAULT_SCOPES: Partial<Record<string, readonly string[]>> = {
  google: Object.values(GOOGLE_APP_SCOPES),
  "google-mail": [GMAIL_READONLY],
  "google-drive": [DRIVE_READONLY],
};

/**
 * The API a proxied request reaches: its host (the Base-Url-Override header, or the
 * integration's own), and the path's prefix on that host. Undefined when the host serves no
 * such path. A host the fake doesn't know fails the test.
 */
export function proxiedSource(host: string, path: string): ProxiedSource | undefined {
  const onHost = PROXIED_SOURCES.filter((source) => source.host === host);
  if (onHost.length === 0) throw new Error(`The fake Nango proxies to no API on ${host}`);
  return onHost.find((source) => path.startsWith(source.prefix));
}

/** What the source answers before reaching its API: 404 off its paths, 403 without a scope. */
export function refusal(
  source: ProxiedSource | undefined,
  connection: FakeConnection,
  method: ProxyMethod = "GET",
) {
  if (source === undefined) {
    return HttpResponse.json({ error: { code: 404, message: "Not Found" } }, { status: 404 });
  }
  const accepted = method === "GET" ? source.scopes : (source.write?.scopes ?? []);
  if (!accepted.some((scope) => connection.scopes.includes(scope))) {
    const message = "Request had insufficient authentication scopes.";
    return HttpResponse.json(
      { error: { code: 403, message, status: "PERMISSION_DENIED" } },
      { status: 403 },
    );
  }
  return undefined;
}
