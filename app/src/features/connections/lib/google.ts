// What a connection's source needs beyond Nango itself: its Nango integration, the API host
// each Google API path is on, which apps its granted scopes allow, and how to read which
// account it reached.
import { z } from "zod";
import { GOOGLE_APP_SCOPES, googleAppSchema, type GoogleApp, type Source } from "../types";
import { NangoConnectionGoneError, nangoProxyGet, type ProxyTarget } from "./nango";

/**
 * The Nango integration (provider config key) behind each source. `google` is the one Google
 * connection per account; `google-mail` and `google-drive` remain for the one-app connections
 * made before it, until they're replaced.
 */
export const INTEGRATIONS: Record<Source, string> = {
  google: "google",
  gmail: "google-mail",
  drive: "google-drive",
};

// Each Google API's host, by the prefix its paths start with. Every proxied call names its
// host with Nango's Base-Url-Override, since one integration reaches them all.
const API_HOSTS: { prefix: string; host: string }[] = [
  { prefix: "/gmail/", host: "https://gmail.googleapis.com" },
  { prefix: "/drive/", host: "https://www.googleapis.com" },
  { prefix: "/v4/spreadsheets", host: "https://sheets.googleapis.com" },
  { prefix: "/calendar/", host: "https://www.googleapis.com" },
  { prefix: "/v1/documents", host: "https://docs.googleapis.com" },
  { prefix: "/tasks/", host: "https://tasks.googleapis.com" },
];

/**
 * Where a Google API path is served: its host, found from the path's prefix. Our own code
 * builds every path, so one no API serves is a bug, not a user's mistake: it's a plain Error,
 * which the action boundary rethrows (src/lib/errors.ts, actionError).
 */
export function proxyTarget(path: string): ProxyTarget {
  const api = API_HOSTS.find(({ prefix }) => path.startsWith(prefix));
  if (api === undefined) throw new Error(`No Google API serves ${path}`);
  return { baseUrl: api.host, path };
}

/**
 * The apps a connection may use. A Google connection's are those whose scope Google granted;
 * a one-app connection's is its own app.
 */
export function grantedApps(source: Source, scopes: readonly string[]): GoogleApp[] {
  if (source !== "google") return [source];
  return googleAppSchema.options.filter((app) => scopes.includes(GOOGLE_APP_SCOPES[app]));
}

/** The apps a Google connection asks for that it wasn't granted. None for a one-app one. */
export function missingApps(source: Source, scopes: readonly string[]): GoogleApp[] {
  if (source !== "google") return [];
  const granted = grantedApps(source, scopes);
  return googleAppSchema.options.filter((app) => !granted.includes(app));
}

const gmailProfile = z.object({ emailAddress: z.string().min(1) });
const driveAbout = z.object({ user: z.object({ emailAddress: z.string().min(1) }) });

type NangoConnection = { connectionId: string; integration: string };

// The apps that can say which account a connection reached, in the order they're asked.
const accountEmailReaders: [GoogleApp, (connection: NangoConnection) => Promise<string>][] = [
  [
    "gmail",
    async (connection) => {
      const target = proxyTarget("/gmail/v1/users/me/profile");
      const profile = await nangoProxyGet(connection, target, gmailProfile);
      if (profile === null) throw new NangoConnectionGoneError();
      return profile.emailAddress;
    },
  ],
  [
    "drive",
    async (connection) => {
      const target = proxyTarget("/drive/v3/about?fields=user(emailAddress)");
      const about = await nangoProxyGet(connection, target, driveAbout);
      if (about === null) throw new NangoConnectionGoneError();
      return about.user.emailAddress;
    },
  ],
];

/**
 * The connected account's address, lowercased, asked of the first app among `apps` that can
 * tell. Undefined when none of them can (the account allowed neither Gmail nor Drive).
 */
export async function readAccountEmail(
  source: Source,
  connectionId: string,
  apps: readonly GoogleApp[],
): Promise<string | undefined> {
  const reader = accountEmailReaders.find(([app]) => apps.includes(app));
  if (reader === undefined) return undefined;
  const email = await reader[1]({ connectionId, integration: INTEGRATIONS[source] });
  return email.toLowerCase();
}
