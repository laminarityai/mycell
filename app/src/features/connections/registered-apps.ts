// The registered apps (ADR-0018): configuration our team writes once we've registered Mycel with
// an app's vendor and added its Nango integration. Connecting, the proxy, custom actions and the
// builder all read it, client code included, so it is pure: no IO and no ctx. It lives here
// because `connections` connects and proxies them, and `custom-actions` imports `connections`.
//
// Registering an app: add its ID to `registeredAppIdSchema` (types.ts), its entry below, its API
// description under `app/api-descriptions/`, how to read which account it reached (lib/apps.ts), its
// integration to `pnpm nango:preflight`, and a fake of it to the fake Nango.
import { GOOGLE_HOSTS } from "@/lib/google";
import {
  GOOGLE_APP_SCOPES,
  registeredAppIdSchema,
  type RegisteredApp,
  type RegisteredAppId,
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
  // The CRM built for small companies: OAuth and the API on every plan, authorized per user
  // (so a member connects their own login, and an org connection is a shared one), and a
  // private app needs no vendor review (docs/research/integrations/hubspot-pipedrive.md).
  // Each company is served on its own subdomain, which Nango reads from the token response
  // (`api_domain`) and proxies to as `<api_domain>/api`, so paths start `/v1/` or `/v2/`.
  pipedrive: {
    id: "pipedrive",
    name: "Pipedrive",
    integration: "pipedrive",
    hosts: ["https://*.pipedrive.com"],
    // Pipedrive's users accept every scope or none. Reading and writing deals, people,
    // organizations, activities and leads, finding records, and naming users: no mail, admin,
    // webhooks or fields (docs/intent.md non-goal 7).
    scopes: [
      "base",
      "deals:full",
      "contacts:full",
      "activities:full",
      "leads:full",
      "search:read",
      "users:read",
    ],
    accountingOrPayments: false,
    bansStoredIndexes: false,
    // v2 replaces v1 where it exists; notes, leads, files and more are still v1 only.
    // Copied 2026-10-21.
    apiDescription: {
      format: "openapi",
      files: [
        {
          path: "api-descriptions/pipedrive/openapi-v1.yaml",
          source: "https://developers.pipedrive.com/docs/api/v1/openapi.yaml",
        },
        {
          path: "api-descriptions/pipedrive/openapi-v2.yaml",
          source: "https://developers.pipedrive.com/docs/api/v2/openapi.yaml",
        },
      ],
    },
  },
};

/** Every registered app, in the order the connections page lists them. */
export const registeredApps: readonly RegisteredApp[] = registeredAppIdSchema.options.map(
  (id) => REGISTERED_APPS[id],
);

/**
 * Whether a URL is on one of the app's hosts: its origin is one of them, or, for a `*.` host,
 * is https on a subdomain of it.
 */
export function isAppHost(app: RegisteredApp, url: string): boolean {
  let origin: URL;
  try {
    origin = new URL(url);
  } catch {
    return false;
  }
  return app.hosts.some((host) => {
    const wildcard = /^https:\/\/\*\.(.+)$/.exec(host)?.[1];
    if (wildcard === undefined) return origin.origin === host;
    return (
      origin.protocol === "https:" && origin.port === "" && origin.hostname.endsWith(`.${wildcard}`)
    );
  });
}
