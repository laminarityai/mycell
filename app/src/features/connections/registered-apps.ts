// The registered apps (ADR-0018): configuration our team writes once we've registered Mycel with
// an app's vendor and added its Nango integration. Connecting, the proxy, custom actions and the
// builder all read it, client code included, so it is pure: no IO and no ctx. It lives here
// because `connections` connects and proxies them, and `custom-actions` imports `connections`.
//
// Registering an app: add its ID to `registeredAppIdSchema` (types.ts), its entry below, its API
// description under `app/api-descriptions/` and the operation index `pnpm api-index` builds from
// it, how to read which account it reached (lib/apps.ts), its integration to
// `pnpm nango:preflight`, and a fake of it to the fake Nango.
import { GOOGLE_API_PREFIXES, GOOGLE_HOSTS } from "@/lib/google";
import {
  GOOGLE_APP_SCOPES,
  registeredAppIdSchema,
  type GoogleApp,
  type RegisteredApp,
  type RegisteredAppId,
  type Source,
} from "./types";

const DISCOVERY = "https://www.googleapis.com/discovery/v1/apis";

export const REGISTERED_APPS: Record<RegisteredAppId, RegisteredApp> = {
  // One connection per Google account, asking for every Google app at once (ADR-0014).
  google: {
    id: "google",
    name: "Google",
    integration: "google",
    hosts: Object.values(GOOGLE_HOSTS),
    scopes: Object.values(GOOGLE_APP_SCOPES),
    accountingOrPayments: false,
    bansStoredIndexes: false,
    // Google publishes Discovery documents rather than OpenAPI; copied 2026-10-21.
    apiDescription: {
      format: "google-discovery",
      files: [
        { path: "api-descriptions/google/gmail-v1.json", source: `${DISCOVERY}/gmail/v1/rest` },
        { path: "api-descriptions/google/drive-v3.json", source: `${DISCOVERY}/drive/v3/rest` },
        { path: "api-descriptions/google/sheets-v4.json", source: `${DISCOVERY}/sheets/v4/rest` },
        {
          path: "api-descriptions/google/calendar-v3.json",
          source: `${DISCOVERY}/calendar/v3/rest`,
        },
        { path: "api-descriptions/google/docs-v1.json", source: `${DISCOVERY}/docs/v1/rest` },
        { path: "api-descriptions/google/tasks-v1.json", source: `${DISCOVERY}/tasks/v1/rest` },
      ],
    },
  },
  // The suite most businesses use (docs/research/integrations/ranking.md: 450M+ paid Microsoft
  // 365 commercial seats, Okta's #1 app), all through Microsoft Graph on one host with one token
  // (docs/research/integrations/microsoft-365.md). Delegated permissions only, so every call acts
  // as the signed-in person and sees only what they can (non-goal 7); asked for all at once, as
  // ADR-0014 does for Google. Most need one tenant-wide admin consent per customer.
  microsoft: {
    id: "microsoft",
    name: "Microsoft 365",
    // Nango's `microsoft` provider: the `common` authority, proxying to graph.microsoft.com.
    integration: "microsoft",
    hosts: ["https://graph.microsoft.com"],
    // Signing in and refreshing, then mail, calendar, contacts, files and Excel (OneDrive and
    // SharePoint), To Do and Planner, and sending in Teams. No shared-mailbox, Teams-reading or
    // admin-only scopes (microsoft-365.md, sections 5 and 8).
    scopes: [
      "openid",
      "profile",
      "offline_access",
      "User.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Contacts.ReadWrite",
      "Files.ReadWrite.All",
      "Sites.ReadWrite.All",
      "Tasks.ReadWrite",
      "Chat.Create",
      "ChatMessage.Send",
      "ChannelMessage.Send",
    ],
    accountingOrPayments: false,
    bansStoredIndexes: false,
    // Microsoft's generated OpenAPI description of Graph v1.0 (44 MB, so kept gzipped). Its
    // server is https://graph.microsoft.com/v1.0, so a call's path starts `/v1.0/`. Copied
    // 2026-10-21.
    apiDescription: {
      format: "openapi",
      files: [
        {
          path: "api-descriptions/microsoft/graph-v1.0-openapi.yaml.gz",
          source:
            "https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml",
        },
      ],
    },
  },
};

/** Every registered app, in the order the connections page lists them. */
export const registeredApps: readonly RegisteredApp[] = registeredAppIdSchema.options.map(
  (id) => REGISTERED_APPS[id],
);

/** The registered app a connection reaches: a one-app connection from before ADR-0014, Google. */
export function registeredAppOf(source: Source): RegisteredAppId {
  return source === "gmail" || source === "drive" ? "google" : source;
}

/**
 * The Google app a path on Google reaches, whose permission a call to it needs (ADR-0014): the
 * one its API's prefix names. Undefined for a path no Google API serves.
 */
export function googleAppOf(path: string): GoogleApp | undefined {
  return GOOGLE_API_PREFIXES.find(({ prefix }) => path.startsWith(prefix))?.app;
}

/**
 * The URL a path reaches on the app: on Google, the host of the API its prefix names; on any
 * other app, its first host, which its Nango integration proxies to. Undefined when the path
 * would leave the app's hosts or isn't plainly a path: it must start with one `/`, and name no
 * host, no `.` or `..` segment, no backslash and no fragment, so the URL is the path as written.
 */
export function appUrl(app: RegisteredApp, path: string): string | undefined {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\#\s]/.test(path)) return undefined;
  const pathname = path.split("?", 1)[0] ?? "";
  if (pathname.split("/").some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return undefined;
  const host =
    app.id === "google"
      ? GOOGLE_API_PREFIXES.find(({ prefix }) => path.startsWith(prefix))?.host
      : app.hosts.at(0);
  if (host === undefined) return undefined;
  const url = new URL(path, host);
  return isAppHost(app, url.href) && url.pathname === pathname ? url.href : undefined;
}

/** Whether a URL is on one of the app's hosts: its origin is exactly one of them. */
export function isAppHost(app: RegisteredApp, url: string): boolean {
  try {
    return app.hosts.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
