// The fake Pipedrive: the registered app the fake Nango proxies a `pipedrive` connection to, on
// the company's own subdomain (Nango reads it from the token response's `api_domain` and calls
// `<api_domain>/api<path>`). It records every request it receives, so a test can check exactly
// what was sent and how often, and answers who the authorized user is. Any other path is 404,
// as Pipedrive answers one it doesn't serve.
import { HttpResponse } from "msw";
import type { ProxyMethod } from "./fake-proxied-sources";

/** One request the fake app received through the proxy. */
export type FakeAppRequest = {
  method: ProxyMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
};

export class FakePipedrive {
  readonly requests: FakeAppRequest[] = [];
  // The company's subdomain: the part of the user's email domain before its first dot.
  readonly companyDomain: string;

  constructor(readonly userEmail: string) {
    this.companyDomain = (userEmail.split("@")[1] ?? "company").split(".")[0] ?? "company";
  }

  /** The company's API origin, as Pipedrive's token response names it. */
  get apiDomain(): string {
    return `https://${this.companyDomain}.pipedrive.com`;
  }

  respond(method: ProxyMethod, path: string, params: URLSearchParams, body: unknown): Response {
    this.requests.push({ method, path, query: Object.fromEntries(params), body });
    if (method === "GET" && path === "/v1/users/me") {
      return HttpResponse.json({
        success: true,
        data: { id: 1, name: "Pipedrive user", email: this.userEmail, active_flag: true },
      });
    }
    return pipedriveError(404, "Unknown method .");
  }
}

/** Pipedrive's error body: a string `error`, with the status as `errorCode`. */
export function pipedriveError(status: number, error: string): Response {
  return HttpResponse.json({ success: false, error, errorCode: status }, { status });
}
