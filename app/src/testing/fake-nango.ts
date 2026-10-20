// The fake Nango: an in-memory Nango Cloud behind msw's fetch interception, so tests run the
// real Nango client (src/features/connections/lib/nango.ts) without network or secrets. It
// implements only the endpoints Mycel calls, with the shapes Nango documents.
import { createHmac, randomUUID } from "node:crypto";
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { FakeMailbox } from "./fake-gmail";

const API = "https://api.nango.dev";

type FakeSession = { token: string; integration: string; tags: Record<string, string> };

/** What the connected account looks like from inside its source. */
export type FakeAccount = { emailAddress: string };

type FakeConnection = {
  connectionId: string;
  integration: string;
  tags: Record<string, string>;
  account: FakeAccount;
  mailbox: FakeMailbox;
};

/** Runs before the fake proxies a request to a source, given the source API path. */
export type ProxyHook = (path: string) => void | Promise<void>;

/** A webhook as Nango delivers it: the raw body and the headers that sign it. */
export type FakeWebhook = { rawBody: string; headers: Headers };

class FakeNango {
  private sessions: FakeSession[] = [];
  private connections = new Map<string, FakeConnection>();
  private deletesFail = false;
  private rateLimitsLeft = 0;
  private rateLimitsServed = 0;
  private proxyHook: ProxyHook | undefined;

  reset(): void {
    this.sessions = [];
    this.connections.clear();
    this.deletesFail = false;
    this.rateLimitsLeft = 0;
    this.rateLimitsServed = 0;
    this.proxyHook = undefined;
  }

  /** The connected account's Gmail mailbox, for seeding messages. */
  mailbox(connectionId: string): FakeMailbox {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) throw new Error(`Unknown connection ${connectionId}`);
    return connection.mailbox;
  }

  /**
   * Makes the source answer the next `count` proxied requests with 429. Like Nango, the proxy
   * retries them when the request's `Retries` header allows, and passes the 429 on otherwise.
   */
  rateLimitSource(count: number): void {
    this.rateLimitsLeft += count;
  }

  /** How many 429s the source has answered (retried or not) since the last reset. */
  rateLimitsAnswered(): number {
    return this.rateLimitsServed;
  }

  /** Runs `hook` before each proxied request, until the next reset. */
  beforeProxy(hook: ProxyHook): void {
    this.proxyHook = hook;
  }

  /** Makes Nango's connection delete endpoint answer 500 until the next reset. */
  failDeletes(): void {
    this.deletesFail = true;
  }

  /** The connect session Mycel created most recently. */
  lastSession(): FakeSession {
    const session = this.sessions.at(-1);
    if (session === undefined) throw new Error("No connect session was created");
    return session;
  }

  /**
   * A user finishes OAuth in Connect UI with the given account: Nango creates the connection
   * and returns the creation webhook it then sends.
   */
  completeConnect(token: string, account: FakeAccount): FakeWebhook & { connectionId: string } {
    const session = this.sessions.find((s) => s.token === token);
    if (session === undefined) throw new Error(`Unknown connect session token ${token}`);
    const connectionId = randomUUID();
    this.connections.set(connectionId, {
      connectionId,
      integration: session.integration,
      tags: session.tags,
      account,
      mailbox: new FakeMailbox(account.emailAddress),
    });
    return { connectionId, ...this.authWebhook(connectionId, "creation", true) };
  }

  /**
   * The connection is deleted at Nango, not by Mycel (from Nango's dashboard, say): it's gone,
   * and Nango sends the deletion webhook.
   */
  deleteOutsideMycel(connectionId: string): FakeWebhook {
    const webhook = this.authWebhook(connectionId, "deletion", true);
    this.connections.delete(connectionId);
    return webhook;
  }

  /** The webhook Nango sends about one of its connections. */
  authWebhook(
    connectionId: string,
    operation: "creation" | "override" | "refresh" | "deletion",
    success: boolean,
  ): FakeWebhook {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) throw new Error(`Unknown connection ${connectionId}`);
    return this.signed({
      from: "nango",
      type: "auth",
      connectionId,
      authMode: "OAUTH2",
      providerConfigKey: connection.integration,
      provider: connection.integration,
      environment: "DEV",
      operation,
      success,
      tags: connection.tags,
      ...(success ? {} : { error: { type: "oauth_error", description: "Access denied" } }),
    });
  }

  /** Any body, signed as Nango signs webhooks (or with another key, to forge one). */
  signed(body: unknown, signingKey = env.NANGO_WEBHOOK_SIGNING_KEY): FakeWebhook {
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", signingKey).update(rawBody).digest("hex");
    return { rawBody, headers: new Headers({ "X-Nango-Hmac-Sha256": signature }) };
  }

  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  readonly handlers = [
    http.post(`${API}/connect/sessions`, async ({ request }) => {
      if (!authorised(request)) return unauthorised();
      const body = (await request.json()) as {
        allowed_integrations: string[];
        tags: Record<string, string>;
      };
      const integration = body.allowed_integrations.at(0);
      if (integration === undefined) return HttpResponse.json({ error: {} }, { status: 400 });
      const token = `nango_connect_session_${randomUUID()}`;
      this.sessions.push({ token, integration, tags: body.tags });
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return HttpResponse.json({ data: { token, expires_at: expiresAt } }, { status: 201 });
    }),

    http.delete(`${API}/connections/:connectionId`, ({ request, params }) => {
      if (!authorised(request)) return unauthorised();
      if (this.deletesFail) {
        return HttpResponse.json({ error: { code: "server_error" } }, { status: 500 });
      }
      const connectionId = String(params.connectionId);
      const key = new URL(request.url).searchParams.get("provider_config_key");
      const connection = this.connections.get(connectionId);
      if (connection?.integration !== key) {
        return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
      }
      this.connections.delete(connectionId);
      return HttpResponse.json({ success: true });
    }),

    http.get(`${API}/proxy/gmail/v1/users/me/*`, async ({ request }) => {
      if (!authorised(request)) return unauthorised();
      const url = new URL(request.url);
      const path = url.pathname.slice("/proxy".length);
      await this.proxyHook?.(path);
      const connection = this.proxied(request);
      if (connection === undefined) {
        return HttpResponse.json({ error: { code: "unknown_connection" } }, { status: 404 });
      }
      const retries = Number(request.headers.get("Retries") ?? 0);
      for (let attempt = 0; attempt <= retries && this.rateLimitsLeft > 0; attempt++) {
        this.rateLimitsLeft -= 1;
        this.rateLimitsServed += 1;
        if (attempt === retries) return gmailError(429, "RESOURCE_EXHAUSTED");
      }
      return gmailResponse(connection.mailbox, path, url.searchParams);
    }),
  ];

  private proxied(request: Request): FakeConnection | undefined {
    const connection = this.connections.get(request.headers.get("Connection-Id") ?? "");
    const key = request.headers.get("Provider-Config-Key");
    return connection?.integration === key ? connection : undefined;
  }
}

function authorised(request: Request): boolean {
  return request.headers.get("Authorization") === `Bearer ${env.NANGO_API_KEY}`;
}

function unauthorised() {
  return HttpResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
}

// The Gmail API behind the proxy, answering from the connection's mailbox.
function gmailResponse(mailbox: FakeMailbox, path: string, params: URLSearchParams) {
  if (path === "/gmail/v1/users/me/profile") return HttpResponse.json(mailbox.profile());
  if (path === "/gmail/v1/users/me/messages") return HttpResponse.json(mailbox.list(params));
  const id = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(path)?.[1];
  if (id === undefined) throw new Error(`The fake Gmail doesn't serve ${path}`);
  if (params.get("format") !== "full") throw new Error("The fake Gmail serves format=full only");
  const message = mailbox.get(decodeURIComponent(id));
  return message === undefined ? gmailError(404, "NOT_FOUND") : HttpResponse.json(message);
}

// An error as Google's APIs return it.
function gmailError(code: 404 | 429, status: string) {
  const message = code === 404 ? "Requested entity was not found." : "User-rate limit exceeded.";
  return HttpResponse.json({ error: { code, message, status } }, { status: code });
}

export const fakeNango = new FakeNango();
