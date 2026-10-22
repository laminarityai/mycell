// The fake Microsoft Graph: the registered app the fake Nango proxies a `microsoft` connection to,
// on graph.microsoft.com. It records every request it receives, so a test can check exactly what
// was sent and how often, and answers who the signed-in user is (`GET /v1.0/me`). Any other path
// is 404, as Graph answers a resource it doesn't have.
import { HttpResponse } from "msw";
import type { ProxyMethod } from "./fake-proxied-sources";

/** One request the fake app received through the proxy. */
export type FakeAppRequest = {
  method: ProxyMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
};

export class FakeMicrosoft {
  readonly requests: FakeAppRequest[] = [];

  constructor(readonly userEmail: string) {}

  respond(method: ProxyMethod, path: string, params: URLSearchParams, body: unknown): Response {
    this.requests.push({ method, path, query: Object.fromEntries(params), body });
    if (method === "GET" && path === "/v1.0/me") {
      return HttpResponse.json({
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
        id: "00000000-0000-0000-0000-000000000001",
        displayName: "Microsoft user",
        mail: this.userEmail,
        userPrincipalName: this.userEmail,
      });
    }
    return graphError(404, "Request_ResourceNotFound", "Resource not found.");
  }
}

/** Graph's error body: `{ error: { code, message } }` with a string code. */
export function graphError(status: number, code: string, message: string): Response {
  return HttpResponse.json({ error: { code, message } }, { status });
}
