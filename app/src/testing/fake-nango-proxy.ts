// The fake Nango's proxy: a GET, POST, PUT, PATCH or DELETE names its connection and integration in
// headers, and its API host with Base-Url-Override (or reaches the integration's own host).
// Like Nango, it retries the source's 429s as the request's Retries header asks, and forwards a
// write's JSON body to the source as it is.
import { http, HttpResponse } from "msw";
import type { FakeConnection } from "./fake-nango";
import { authorised, NANGO_API as API, proxyRefusal, unauthorised } from "./fake-nango-http";
import {
  INTEGRATION_HOSTS,
  proxiedSource,
  refusal,
  type ProxyMethod,
} from "./fake-proxied-sources";

/** What the proxy needs from the fake Nango: its connections, hook and rate limiting. */
export type ProxyState = {
  connection(connectionId: string): FakeConnection | undefined;
  beforeProxy(path: string): void | Promise<void>;
  // Takes one of the 429s a test asked for, if any are left.
  takeRateLimit(): boolean;
  // Takes one of the failed writes a test asked for, if any are left.
  takeWriteFailure(): boolean;
};

export function proxyHandlers(state: ProxyState) {
  return [
    http.get(`${API}/proxy/*`, ({ request }) => proxy(state, request, "GET")),
    http.post(`${API}/proxy/*`, ({ request }) => proxy(state, request, "POST")),
    http.put(`${API}/proxy/*`, ({ request }) => proxy(state, request, "PUT")),
    http.patch(`${API}/proxy/*`, ({ request }) => proxy(state, request, "PATCH")),
    http.delete(`${API}/proxy/*`, ({ request }) => proxy(state, request, "DELETE")),
  ];
}

async function proxy(state: ProxyState, request: Request, method: ProxyMethod) {
  if (!authorised(request)) return unauthorised();
  const url = new URL(request.url);
  const path = url.pathname.slice("/proxy".length);
  await state.beforeProxy(path);
  const connection = state.connection(request.headers.get("Connection-Id") ?? "");
  if (connection?.integration !== request.headers.get("Provider-Config-Key")) {
    return proxyRefusal("no-connection");
  }
  if (connection.refreshFails === true) return proxyRefusal("refresh-failed");
  const host = baseUrl(request, connection);
  const source = proxiedSource(host, path);
  const refused = refusal(source, connection, method, path);
  if (refused !== undefined || source === undefined) return refused;
  const retries = Number(request.headers.get("Retries") ?? 0);
  for (let attempt = 0; attempt <= retries && state.takeRateLimit(); attempt++) {
    if (attempt === retries) return source.rateLimited();
  }
  if (method === "GET") return source.respond(connection, path, url.searchParams);
  if (source.write === undefined) throw new Error(`The fake ${host} takes no ${method}s`);
  if (state.takeWriteFailure()) {
    const error = { code: 500, message: "Internal error encountered.", status: "INTERNAL" };
    return HttpResponse.json({ error }, { status: 500 });
  }
  // A DELETE has no body.
  const text = await request.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  return source.write.respond(connection, path, url.searchParams, body, method);
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
