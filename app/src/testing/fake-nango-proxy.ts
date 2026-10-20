// The fake Nango's proxy: a GET names its connection and integration in headers, and its API
// host with Base-Url-Override (or reaches the integration's own host). Like Nango, it retries
// the source's 429s as the request's Retries header asks.
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import type { FakeConnection } from "./fake-nango";
import { INTEGRATION_HOSTS, proxiedSource, refusal } from "./fake-proxied-sources";

const API = "https://api.nango.dev";

/** What the proxy needs from the fake Nango: its connections, hook and rate limiting. */
export type ProxyState = {
  connection(connectionId: string): FakeConnection | undefined;
  beforeProxy(path: string): void | Promise<void>;
  // Takes one of the 429s a test asked for, if any are left.
  takeRateLimit(): boolean;
};

export function proxyHandlers(state: ProxyState) {
  return [
    http.get(`${API}/proxy/*`, async ({ request }) => {
      if (request.headers.get("Authorization") !== `Bearer ${env.NANGO_API_KEY}`) {
        return HttpResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
      }
      const url = new URL(request.url);
      const path = url.pathname.slice("/proxy".length);
      await state.beforeProxy(path);
      const connection = state.connection(request.headers.get("Connection-Id") ?? "");
      if (connection?.integration !== request.headers.get("Provider-Config-Key")) {
        return HttpResponse.json({ error: { code: "unknown_connection" } }, { status: 404 });
      }
      const host = baseUrl(request, connection);
      const source = proxiedSource(host, path);
      const refused = refusal(source, connection);
      if (refused !== undefined || source === undefined) return refused;
      const retries = Number(request.headers.get("Retries") ?? 0);
      for (let attempt = 0; attempt <= retries && state.takeRateLimit(); attempt++) {
        if (attempt === retries) return source.rateLimited();
      }
      return source.respond(connection, path, url.searchParams);
    }),
  ];
}

// Nango takes Base-Url-Override as a full URL; without one, the integration's own host.
function baseUrl(request: Request, connection: FakeConnection): string {
  const override = request.headers.get("Base-Url-Override");
  if (override === null || override === "") {
    const host = INTEGRATION_HOSTS[connection.integration];
    if (host === undefined) throw new Error(`No host for integration ${connection.integration}`);
    return host;
  }
  return new URL(override).origin;
}
