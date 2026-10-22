// What a connection needs from its app beyond Nango itself, for every registered app: the Nango
// integration behind its source, where a proxied path goes, which Google apps it may use, whether
// discovery ingests from it, and how to read which account it reached.
import { z } from "zod";
import { REGISTERED_APPS } from "../registered-apps";
import type { GoogleApp, RegisteredAppId, Source } from "../types";
import {
  grantedApps as googleGrantedApps,
  missingApps as googleMissingApps,
  proxyTarget,
  readGoogleAccountEmail,
  type GoogleSource,
} from "./google";
import { NangoConnectionGoneError, nangoProxyGet, type ProxyTarget } from "./nango";

// The one-app integrations that connections from before ADR-0014 still use, until replaced.
const ONE_APP_INTEGRATIONS = { gmail: "google-mail", drive: "google-drive" } as const;

/** The Nango integration (provider config key) behind a source. */
export function integrationOf(source: Source): string {
  return isOneApp(source) ? ONE_APP_INTEGRATIONS[source] : REGISTERED_APPS[source].integration;
}

/** Whether the source reaches Google: one Google connection, or a one-app one from before. */
export function isGoogle(source: Source): source is GoogleSource {
  return source === "google" || isOneApp(source);
}

function isOneApp(source: Source): source is "gmail" | "drive" {
  return source === "gmail" || source === "drive";
}

/**
 * Whether discovery ingests from the source: Google's connections only. No other registered
 * app is a discovery source yet (M13), so connecting one starts no backfill.
 */
export function ingestsFrom(source: Source): boolean {
  return isGoogle(source);
}

/**
 * Where a proxied path goes. A Google path names its API's host from its prefix, since one
 * integration reaches them all; any other app's path goes to the host Nango keeps for its
 * integration. Our own code builds every path, so one that isn't a path on the app is a bug.
 */
export function proxyTargetFor(source: Source, path: string): ProxyTarget {
  if (isGoogle(source)) return proxyTarget(path);
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`${path} isn't a path on ${REGISTERED_APPS[source].name}`);
  }
  return { path };
}

/** The Google apps a connection may use, from its granted scopes. None for any other app. */
export function grantedApps(source: Source, scopes: readonly string[]): GoogleApp[] {
  return isGoogle(source) ? googleGrantedApps(source, scopes) : [];
}

/** The Google apps a Google connection asks for and wasn't granted. None for any other app. */
export function missingApps(source: Source, scopes: readonly string[]): GoogleApp[] {
  return isGoogle(source) ? googleMissingApps(source, scopes) : [];
}

type NangoConnection = { connectionId: string; integration: string };

// How each registered app other than Google says which account a connection reached.
const accountEmailReaders: Record<
  Exclude<RegisteredAppId, "google">,
  (connection: NangoConnection) => Promise<string>
> = {
  // The authorized user, with the `base` scope every Pipedrive app has.
  pipedrive: async (connection) => {
    const me = await nangoProxyGet(connection, { path: "/v1/users/me" }, pipedriveUser);
    if (me === null) throw new NangoConnectionGoneError();
    return me.data.email;
  },
};

const pipedriveUser = z.object({ data: z.object({ email: z.string().min(1) }) });

/**
 * The connected account's address, lowercased. A Google connection asks the first of its
 * granted apps that can tell, and is undefined when none can (the account allowed neither
 * Gmail nor Drive); any other app asks who the authorized user is.
 */
export async function readAccountEmail(
  source: Source,
  connectionId: string,
  scopes: readonly string[],
): Promise<string | undefined> {
  const connection = { connectionId, integration: integrationOf(source) };
  const email = isGoogle(source)
    ? await readGoogleAccountEmail(connection, googleGrantedApps(source, scopes))
    : await accountEmailReaders[source](connection);
  return email?.toLowerCase();
}
