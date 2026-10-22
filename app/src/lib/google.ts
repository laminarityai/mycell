// Google's API hosts and OAuth scope URLs, defined once: the action catalog names the host each
// action reaches and the scopes it needs, and connections proxies to those hosts and asks for
// those scopes. Neither may import the other, so both import these.

/** Each Google API host Mycel reaches through the Nango proxy (ADR-0014). */
export const GOOGLE_HOSTS = {
  gmail: "https://gmail.googleapis.com",
  /** Drive's and Calendar's APIs are served here. */
  www: "https://www.googleapis.com",
  sheets: "https://sheets.googleapis.com",
  docs: "https://docs.googleapis.com",
  tasks: "https://tasks.googleapis.com",
} as const;

/** The Google apps a Google connection asks for, in the order the UI lists them. */
export const GOOGLE_APPS = ["gmail", "drive", "sheets", "calendar", "docs", "tasks"] as const;
export type GoogleApp = (typeof GOOGLE_APPS)[number];

/**
 * Each Google API's host, and the Google app whose permission its calls need, by the prefix its
 * paths start with. Every proxied call names its host with Nango's Base-Url-Override, since one
 * integration reaches them all.
 */
export const GOOGLE_API_PREFIXES: readonly { prefix: string; host: string; app: GoogleApp }[] = [
  { prefix: "/gmail/", host: GOOGLE_HOSTS.gmail, app: "gmail" },
  { prefix: "/drive/", host: GOOGLE_HOSTS.www, app: "drive" },
  { prefix: "/v4/spreadsheets", host: GOOGLE_HOSTS.sheets, app: "sheets" },
  { prefix: "/calendar/", host: GOOGLE_HOSTS.www, app: "calendar" },
  { prefix: "/v1/documents", host: GOOGLE_HOSTS.docs, app: "docs" },
  { prefix: "/tasks/", host: GOOGLE_HOSTS.tasks, app: "tasks" },
];

/** What every Google OAuth scope URL starts with. */
export const GOOGLE_SCOPE_PREFIX = "https://www.googleapis.com/auth/";

/** A Google OAuth scope's full URL, from its short name (`gmail.modify`). */
export function googleScope(name: string): string {
  return `${GOOGLE_SCOPE_PREFIX}${name}`;
}
