// The Nango client: the only code that talks to Nango. Every response is parsed with Zod.
// Content goes through the proxy only, never Nango syncs (docs/architecture.md, "Data handling").
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import { SourceRequestError } from "../types";

/** The Nango connection no longer exists (deleted at Nango, or never created). */
export class NangoConnectionGoneError extends Error {
  constructor() {
    super("The Nango connection no longer exists.");
    this.name = "NangoConnectionGoneError";
  }
}

const connectSessionResponse = z.object({ data: z.object({ token: z.string().min(1) }) });

export type ConnectSessionRequest = {
  integration: string;
  // Copied onto the connection and sent back on its webhooks. Nango lowercases keys, and allows
  // at most 10 of them.
  tags: Record<string, string>;
};

export async function createConnectSession(request: ConnectSessionRequest): Promise<string> {
  const response = await nangoFetch("/connect/sessions", {
    method: "POST",
    body: JSON.stringify({ allowed_integrations: [request.integration], tags: request.tags }),
  });
  if (!response.ok) throw new Error(`Nango connect session failed: ${String(response.status)}`);
  return connectSessionResponse.parse(await response.json()).data.token;
}

/**
 * A connect session that re-authorizes an existing connection (its token was revoked or
 * expired). Connect UI opens with it like a connect, and Nango then sends `auth` / `override`.
 */
export async function createReconnectSession(
  connectionId: string,
  integration: string,
): Promise<string> {
  const response = await nangoFetch("/connect/sessions/reconnect", {
    method: "POST",
    body: JSON.stringify({ connection_id: connectionId, integration_id: integration }),
  });
  if (!response.ok) throw new Error(`Nango reconnect session failed: ${String(response.status)}`);
  return connectSessionResponse.parse(await response.json()).data.token;
}

/** Deletes the connection at Nango, revoking Mycel's access. Already gone counts as done. */
export async function deleteNangoConnection(
  connectionId: string,
  integration: string,
): Promise<void> {
  const query = new URLSearchParams({ provider_config_key: integration });
  const response = await nangoFetch(
    `/connections/${encodeURIComponent(connectionId)}?${query.toString()}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Nango connection delete failed: ${String(response.status)}`);
  }
}

/** A connection as Nango lists it: no credentials, just which integration and its tags. */
export type ListedNangoConnection = {
  connectionId: string;
  integration: string;
  tags: Partial<Record<string, string>>;
};

const connectionsPage = z.object({
  connections: z.array(
    z.object({
      connection_id: z.string().min(1),
      provider_config_key: z.string().min(1),
      tags: z.record(z.string(), z.unknown()).nullish(),
    }),
  ),
});

// Nango caps a page at 2000. Its pages are numbered from 0, and it signals no last page, and
// may serve fewer than asked: the listing ends at the first empty page.
const LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGES = 1000;

/**
 * Every connection in Mycel's Nango environment, across all pages. Throws rather than return
 * a listing it can't vouch for: a failed page, or pages that repeat (paging being ignored).
 */
export async function listNangoConnections(): Promise<ListedNangoConnection[]> {
  const listed = new Map<string, ListedNangoConnection>();
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(LIST_PAGE_SIZE), page: String(page) });
    const response = await nangoFetch(`/connections?${query.toString()}`, { method: "GET" });
    if (!response.ok) throw new Error(`Nango connection list failed: ${String(response.status)}`);
    const { connections } = connectionsPage.parse(await response.json());
    if (connections.length === 0) return [...listed.values()];
    let added = 0;
    for (const connection of connections) {
      const key = `${connection.provider_config_key}/${connection.connection_id}`;
      if (listed.has(key)) continue;
      added += 1;
      listed.set(key, {
        connectionId: connection.connection_id,
        integration: connection.provider_config_key,
        tags: stringTags(connection.tags ?? {}),
      });
    }
    if (added === 0) throw new Error(`Nango repeated page ${String(page)} of its connections`);
  }
  throw new Error(`Nango listed more than ${String(MAX_LIST_PAGES)} pages of connections`);
}

// Mycel's tags are strings; anything else on a listed connection isn't Mycel's and is dropped.
function stringTags(tags: Record<string, unknown>): Partial<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/**
 * Asks Nango about one connection by ID: false only when Nango answers that it has no such
 * connection. Any other failure throws, so an outage never reads as "gone".
 */
export async function nangoConnectionExists(
  connectionId: string,
  integration: string,
): Promise<boolean> {
  // The response carries credentials; only the status is read, and nothing is kept.
  const query = new URLSearchParams({ provider_config_key: integration });
  const response = await nangoFetch(
    `/connections/${encodeURIComponent(connectionId)}?${query.toString()}`,
    { method: "GET" },
  );
  await response.body?.cancel();
  // 424: Nango has the connection, but its token refresh is exhausted.
  if (response.ok || response.status === 424) return true;
  if (response.status === 404) return false;
  throw new Error(`Nango connection read failed: ${String(response.status)}`);
}

// The parts of a connection Mycel reads: Google's token response, kept whole by Nango as
// `credentials.raw`, whose `scope` lists the granted scopes, space-separated.
const connectionCredentials = z.object({
  credentials: z.object({
    raw: z.object({ scope: z.string().optional() }).optional(),
  }),
});

/**
 * The OAuth scopes Google granted the connection, from Nango's copy of its token response.
 * Throws NangoConnectionGoneError when Nango has no such connection.
 */
export async function readGrantedScopes(
  connectionId: string,
  integration: string,
): Promise<string[]> {
  // The response carries credentials; only the scopes are read, and nothing else is kept.
  const query = new URLSearchParams({ provider_config_key: integration });
  const response = await nangoFetch(
    `/connections/${encodeURIComponent(connectionId)}?${query.toString()}`,
    { method: "GET" },
  );
  if (response.status === 404) throw new NangoConnectionGoneError();
  if (!response.ok) throw new Error(`Nango connection read failed: ${String(response.status)}`);
  const { credentials } = connectionCredentials.parse(await response.json());
  return (credentials.raw?.scope ?? "").split(/\s+/).filter((scope) => scope !== "");
}

// An error body from Nango itself rather than from the source: Nango's codes are strings, and
// Google's are numbers. For a connection it doesn't have, the proxy answers 400
// `{ error: { code: "server_error", message: "Failed to get connection" } }`, the same code it
// uses when a token refresh fails (allProxy.ts, handleProxyServiceErrorResponse), so the code
// alone can't say the connection is gone.
const nangoError = z.object({ error: z.object({ code: z.string() }) });

/** A call through the Nango proxy: which API host it reaches, and the path on that host. */
export type ProxyTarget = { baseUrl: string; path: string };

type ProxiedConnection = { connectionId: string; integration: string };

/**
 * A GET through the Nango proxy to the source's own API, parsed with `schema`. Returns null when
 * the source answers 404 or 410 (the item is gone at the source), and throws
 * NangoConnectionGoneError when Nango no longer has the connection (asked by ID whenever Nango
 * itself refuses the call), and SourceRequestError for any other refusal.
 */
export async function nangoProxyGet<T>(
  connection: ProxiedConnection,
  target: ProxyTarget,
  schema: z.ZodType<T>,
): Promise<T | null> {
  // Nango retries the source's 429s and 5xx with exponential backoff: a GET changes nothing.
  return nangoProxy(connection, target, schema, { headers: { Retries: "3" } });
}

/**
 * A POST through the Nango proxy with a JSON body, answered like nangoProxyGet. Nango doesn't
 * retry it: a write whose answer was lost may have happened, so the caller checks for its own
 * earlier result before writing again.
 */
export async function nangoProxyPost<T>(
  connection: ProxiedConnection,
  target: ProxyTarget,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T | null> {
  return nangoProxy(connection, target, schema, { method: "POST", body: JSON.stringify(body) });
}

/** A PUT through the Nango proxy with a JSON body, answered and not retried like a POST. */
export async function nangoProxyPut<T>(
  connection: ProxiedConnection,
  target: ProxyTarget,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T | null> {
  return nangoProxy(connection, target, schema, { method: "PUT", body: JSON.stringify(body) });
}

/**
 * A DELETE through the Nango proxy, not retried. True when the source deleted the item, false
 * when it had no such item (404 or 410); refusals throw as for the other verbs.
 */
export async function nangoProxyDelete(
  connection: ProxiedConnection,
  target: ProxyTarget,
): Promise<boolean> {
  return (await nangoProxy(connection, target, z.unknown(), { method: "DELETE" })) !== null;
}

async function nangoProxy<T>(
  connection: ProxiedConnection,
  { baseUrl, path }: ProxyTarget,
  schema: z.ZodType<T>,
  init: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<T | null> {
  const response = await nangoFetch(`/proxy${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "Connection-Id": connection.connectionId,
      "Provider-Config-Key": connection.integration,
      // One Nango integration reaches every Google API, each on its own host.
      "Base-Url-Override": baseUrl,
    },
  });
  if (response.ok) {
    // A DELETE's answer has no body.
    const text = await response.text();
    return schema.parse(text === "" ? undefined : JSON.parse(text));
  }
  const raw: unknown = await response.json().catch(() => undefined);
  if (
    nangoError.safeParse(raw).success &&
    !(await nangoConnectionExists(connection.connectionId, connection.integration))
  ) {
    throw new NangoConnectionGoneError();
  }
  if (response.status === 404 || response.status === 410) return null;
  throw new SourceRequestError(response.status, raw, path);
}

/** Whether a webhook body really came from Nango: a hex HMAC-SHA256 of the raw body. */
export function isSignedByNango(rawBody: string, signature: string | null): boolean {
  if (signature === null) return false;
  const expected = createHmac("sha256", env.NANGO_WEBHOOK_SIGNING_KEY)
    .update(rawBody)
    .digest("hex");
  const given = Buffer.from(signature, "utf8");
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected, "utf8"));
}

export const NANGO_SIGNATURE_HEADER = "x-nango-hmac-sha256";

async function nangoFetch(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.NANGO_API_KEY}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${env.NANGO_API_URL}${path}`, { ...init, headers });
}
