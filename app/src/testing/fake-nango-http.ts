// What the fake Nango's handlers share: the API URL, the API key check, and the proxy's own
// refusals.
import { HttpResponse } from "msw";
import { env } from "@/env";

export const NANGO_API = "https://api.nango.dev";

/** Whether the request carries the environment's API key, as every Nango endpoint needs. */
export function authorised(request: Request): boolean {
  return request.headers.get("Authorization") === `Bearer ${env.NANGO_API_KEY}`;
}

export function unauthorised() {
  return HttpResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
}

/**
 * Nango's proxy refusing a call itself, before reaching the source. A connection it doesn't
 * have and a token Google won't refresh get the same code (checked against Nango Cloud and
 * allProxy.ts's handleProxyServiceErrorResponse), so only reading the connection by ID tells
 * them apart. The refresh failure's status is the refresh error's own: 424 is unverified.
 */
export function proxyRefusal(reason: "no-connection" | "refresh-failed") {
  const message =
    reason === "no-connection"
      ? "Failed to get connection"
      : "Failed to get connection credentials: 'invalid_grant'";
  const status = reason === "no-connection" ? 400 : 424;
  return HttpResponse.json({ error: { code: "server_error", message } }, { status });
}
