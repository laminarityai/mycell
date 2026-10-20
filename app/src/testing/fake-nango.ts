// The fake Nango: an in-memory Nango Cloud behind msw's fetch interception, so tests run the
// real Nango client without network or secrets. Only the endpoints Mycel calls, as documented.
import { createHmac, randomUUID } from "node:crypto";
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { FakeDrive } from "./fake-drive";
import { FakeMailbox } from "./fake-gmail";
import { connectionsApiHandlers, type ListingBehaviour } from "./fake-nango-connections";
import { proxyHandlers } from "./fake-nango-proxy";
import { DEFAULT_SCOPES } from "./fake-proxied-sources";
import { FakeSheets } from "./fake-sheets";

const API = "https://api.nango.dev";

type FakeSession = { token: string; integration: string; tags: Record<string, string> };

// A reconnect session: Connect UI re-authorizes this existing connection.
type FakeReconnectSession = { token: string; connectionId: string; integration: string };

/** What the connected account looks like from inside its source. */
export type FakeAccount = { emailAddress: string };

export type FakeConnection = {
  // Nango's own numeric ID, beside the connection ID Mycel uses.
  id: number;
  created: string;
  connectionId: string;
  integration: string;
  tags: Record<string, string>;
  account: FakeAccount;
  // The OAuth scopes Google granted, as Nango reports them in the token response.
  scopes: readonly string[];
  // The account's Gmail mailbox, Drive and spreadsheets. The proxy reaches each through its
  // API's host, if the connection's scopes allow that API.
  mailbox: FakeMailbox;
  drive: FakeDrive;
  sheets: FakeSheets;
};

/** Runs before the fake proxies a request to a source, given the source API path. */
export type ProxyHook = (path: string) => void | Promise<void>;

/** A webhook as Nango delivers it: the raw body and the headers that sign it. */
export type FakeWebhook = { rawBody: string; headers: Headers };

class FakeNango {
  private sessions: FakeSession[] = [];
  private reconnectSessions: FakeReconnectSession[] = [];
  private connections = new Map<string, FakeConnection>();
  private deletesFail = false;
  private rateLimitsLeft = 0;
  private rateLimitsServed = 0;
  private writeFailuresLeft = 0;
  private proxyHook: ProxyHook | undefined;
  private nextId = 1;
  private listing: ListingBehaviour = { pageCap: undefined, empty: false };

  reset(): void {
    this.sessions = [];
    this.reconnectSessions = [];
    this.connections.clear();
    this.deletesFail = false;
    this.rateLimitsLeft = 0;
    this.rateLimitsServed = 0;
    this.writeFailuresLeft = 0;
    this.proxyHook = undefined;
    this.nextId = 1;
    this.listing = { pageCap: undefined, empty: false };
  }

  /** The connected account's Gmail mailbox, for seeding messages. */
  mailbox = (connectionId: string): FakeMailbox => this.connection(connectionId).mailbox;

  /** The connected account's Drive, for seeding files. */
  drive = (connectionId: string): FakeDrive => this.connection(connectionId).drive;

  /** The connected account's spreadsheets, for seeding sheets. */
  sheets = (connectionId: string): FakeSheets => this.connection(connectionId).sheets;

  private connection(connectionId: string): FakeConnection {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) throw new Error(`Unknown connection ${connectionId}`);
    return connection;
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

  /** Makes the source answer the next `count` proxied writes (POSTs) with 500, unmade. */
  failWrites(count: number): void {
    this.writeFailuresLeft += count;
  }

  /** Runs `hook` before each proxied request, until the next reset. */
  beforeProxy(hook: ProxyHook): void {
    this.proxyHook = hook;
  }

  /** Makes Nango's connection delete endpoint answer 500, until `failDeletes(false)` or reset. */
  failDeletes(failing = true): void {
    this.deletesFail = failing;
  }

  /** Serves at most `size` connections per page of the list endpoint, whatever is asked. */
  capListPage(size: number): void {
    this.listing.pageCap = size;
  }

  /**
   * Makes the list endpoint answer 200 with no connections (an outage, or a key for the wrong
   * environment), until the next reset. Reading one connection by ID still finds it.
   */
  listNothing(): void {
    this.listing.empty = true;
  }

  /** The connect session Mycel created most recently. */
  lastSession(): FakeSession {
    const session = this.sessions.at(-1);
    if (session === undefined) throw new Error("No connect session was created");
    return session;
  }

  /**
   * A user finishes OAuth in Connect UI with the given account, granting `scopes` (by default
   * everything the integration asks for): Nango creates the connection and returns the
   * creation webhook it then sends.
   */
  completeConnect(
    token: string,
    account: FakeAccount,
    scopes?: readonly string[],
  ): FakeWebhook & { connectionId: string } {
    const session = this.sessions.find((s) => s.token === token);
    if (session === undefined) throw new Error(`Unknown connect session token ${token}`);
    const connectionId = randomUUID();
    this.connections.set(connectionId, {
      id: this.nextId++,
      created: new Date().toISOString(),
      connectionId,
      integration: session.integration,
      tags: session.tags,
      account,
      scopes: scopes ?? DEFAULT_SCOPES[session.integration] ?? [],
      mailbox: new FakeMailbox(account.emailAddress),
      drive: new FakeDrive(account.emailAddress),
      sheets: new FakeSheets(),
    });
    return { connectionId, ...this.authWebhook(connectionId, "creation", true) };
  }

  /** The reconnect sessions Mycel has created since the last reset, oldest first. */
  reconnectSessionsCreated(): readonly FakeReconnectSession[] {
    return this.reconnectSessions;
  }

  /**
   * A user finishes OAuth in Connect UI opened with a reconnect session: Nango replaces the
   * connection's credentials and returns the `override` webhook it then sends. Choosing a
   * different Google account than before swaps in that account's (empty) mailbox, Drive and
   * spreadsheets.
   * `scopes`, when given, are what the new token was granted; otherwise they stay as they were.
   */
  completeReconnect(token: string, account?: FakeAccount, scopes?: readonly string[]): FakeWebhook {
    const session = this.reconnectSessions.find((s) => s.token === token);
    if (session === undefined) throw new Error(`Unknown reconnect session token ${token}`);
    const connection = this.connection(session.connectionId);
    if (scopes !== undefined) connection.scopes = scopes;
    if (account !== undefined && account.emailAddress !== connection.account.emailAddress) {
      connection.account = account;
      connection.mailbox = new FakeMailbox(account.emailAddress);
      connection.drive = new FakeDrive(account.emailAddress);
      connection.sheets = new FakeSheets();
    }
    return this.authWebhook(session.connectionId, "override", true);
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

  /** The connection is deleted at Nango and no webhook reaches Mycel (a bulk delete, say). */
  deleteWithoutWebhook(connectionId: string): void {
    if (!this.connections.delete(connectionId)) {
      throw new Error(`Unknown connection ${connectionId}`);
    }
  }

  /** The webhook Nango sends about one of its connections. */
  authWebhook(
    connectionId: string,
    operation: "creation" | "override" | "refresh" | "deletion",
    success: boolean,
  ): FakeWebhook {
    const connection = this.connection(connectionId);
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
    ...connectionsApiHandlers(
      () => [...this.connections.values()],
      () => this.listing,
    ),
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

    http.post(`${API}/connect/sessions/reconnect`, async ({ request }) => {
      if (!authorised(request)) return unauthorised();
      const body = (await request.json()) as { connection_id?: string; integration_id?: string };
      const connection = this.connections.get(body.connection_id ?? "");
      if (connection === undefined || connection.integration !== body.integration_id) {
        return HttpResponse.json({ error: { code: "unknown_connection" } }, { status: 400 });
      }
      const token = `nango_connect_session_${randomUUID()}`;
      this.reconnectSessions.push({
        token,
        connectionId: connection.connectionId,
        integration: connection.integration,
      });
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

    ...proxyHandlers({
      connection: (connectionId) => this.connections.get(connectionId),
      beforeProxy: (path) => this.proxyHook?.(path),
      takeRateLimit: () => {
        if (this.rateLimitsLeft === 0) return false;
        this.rateLimitsLeft -= 1;
        this.rateLimitsServed += 1;
        return true;
      },
      takeWriteFailure: () => {
        if (this.writeFailuresLeft === 0) return false;
        this.writeFailuresLeft -= 1;
        return true;
      },
    }),
  ];
}

function authorised(request: Request): boolean {
  return request.headers.get("Authorization") === `Bearer ${env.NANGO_API_KEY}`;
}

function unauthorised() {
  return HttpResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
}

export const fakeNango = new FakeNango();
