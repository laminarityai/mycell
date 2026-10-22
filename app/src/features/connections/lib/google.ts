// What a Google connection needs beyond Nango itself: the API host each Google API path is on,
// which apps its granted scopes allow, and how to read which account it reached.
import { z } from "zod";
import { InvariantError } from "@/lib/errors";
import { GOOGLE_API_PREFIXES } from "@/lib/google";
import { GOOGLE_APP_SCOPES, googleAppSchema, type GoogleApp } from "../types";
import { NangoConnectionGoneError, nangoProxyGet, type ProxyTarget } from "./nango";

/** The sources that reach Google: one Google connection, or a one-app one from before it. */
export type GoogleSource = "google" | "gmail" | "drive";

/**
 * Where a Google API path is served: its host, found from the path's prefix. Our own code
 * builds every path, so one no API serves is a bug, not a user's mistake: InvariantError, which
 * the action boundary rethrows (src/lib/errors.ts, actionError).
 */
export function proxyTarget(path: string): ProxyTarget {
  const api = GOOGLE_API_PREFIXES.find(({ prefix }) => path.startsWith(prefix));
  if (api === undefined) throw new InvariantError(`No Google API serves ${path}`);
  return { baseUrl: api.host, path };
}

/**
 * The apps a connection may use. A Google connection's are those whose scope Google granted;
 * a one-app connection's is its own app.
 */
export function grantedApps(source: GoogleSource, scopes: readonly string[]): GoogleApp[] {
  if (source !== "google") return [source];
  return googleAppSchema.options.filter((app) => scopes.includes(GOOGLE_APP_SCOPES[app]));
}

/** The apps a Google connection asks for that it wasn't granted. None for a one-app one. */
export function missingApps(source: GoogleSource, scopes: readonly string[]): GoogleApp[] {
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
 * The connected Google account's address, asked of the first app among `apps` that can tell.
 * Undefined when none of them can (the account allowed neither Gmail nor Drive).
 */
export async function readGoogleAccountEmail(
  connection: NangoConnection,
  apps: readonly GoogleApp[],
): Promise<string | undefined> {
  const reader = accountEmailReaders.find(([app]) => apps.includes(app));
  return reader === undefined ? undefined : reader[1](connection);
}
