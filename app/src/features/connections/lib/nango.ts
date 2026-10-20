// The Nango client: the only code that talks to Nango. Every response is parsed with Zod.
// Content goes through the proxy only, never Nango syncs (docs/architecture.md, "Data handling").
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";

export const NANGO_API_URL = "https://api.nango.dev";

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

/** A GET through the Nango proxy to the source's own API, parsed with `schema`. */
export async function proxyGet<T>(
  connection: { connectionId: string; integration: string },
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await nangoFetch(`/proxy${path}`, {
    headers: {
      "Connection-Id": connection.connectionId,
      "Provider-Config-Key": connection.integration,
      // Nango retries 429s and 5xx with exponential backoff.
      Retries: "3",
    },
  });
  if (response.status === 404 || response.status === 410) throw new NangoConnectionGoneError();
  if (!response.ok) throw new Error(`Nango proxy ${path} failed: ${String(response.status)}`);
  return schema.parse(await response.json());
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
  return fetch(`${NANGO_API_URL}${path}`, { ...init, headers });
}
