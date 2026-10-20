// The fake Nango's connect sessions: creating one (POST /connect/sessions) and a reconnect
// session for an existing connection (POST /connect/sessions/reconnect), in the shapes Nango
// documents, with the tag rules and errors its source applies.
import { randomUUID } from "node:crypto";
import { http, HttpResponse } from "msw";
import { authorised, NANGO_API, unauthorised } from "./fake-nango-http";

export type FakeSession = { token: string; integration: string; tags: Record<string, string> };

// A reconnect session: Connect UI re-authorizes this existing connection.
export type FakeReconnectSession = { token: string; connectionId: string; integration: string };

/** Reads one of the fake's connections, by Nango connection ID. */
type FindConnection = (connectionId: string) => { integration: string } | undefined;

export class FakeSessions {
  connects: FakeSession[] = [];
  reconnects: FakeReconnectSession[] = [];

  reset(): void {
    this.connects = [];
    this.reconnects = [];
  }

  handlers(find: FindConnection) {
    return [
      http.post(`${NANGO_API}/connect/sessions`, async ({ request }) => {
        if (!authorised(request)) return unauthorised();
        const body = (await request.json()) as {
          allowed_integrations: string[];
          tags: Record<string, string>;
        };
        const integration = body.allowed_integrations.at(0);
        const tags = nangoTags(body.tags);
        if (integration === undefined || tags === undefined) {
          return HttpResponse.json({ error: { code: "invalid_body" } }, { status: 400 });
        }
        const token = newToken();
        this.connects.push({ token, integration, tags });
        return sessionCreated(token);
      }),

      http.post(`${NANGO_API}/connect/sessions/reconnect`, async ({ request }) => {
        if (!authorised(request)) return unauthorised();
        const body = (await request.json()) as { connection_id?: string; integration_id?: string };
        const connectionId = body.connection_id ?? "";
        const integration = find(connectionId)?.integration;
        if (integration === undefined || integration !== body.integration_id) {
          // Nango's own answer (controllers/connect/postReconnect.ts, and Nango Cloud).
          const message = "ConnectionID or IntegrationId does not exists";
          return HttpResponse.json({ error: { code: "invalid_body", message } }, { status: 400 });
        }
        const token = newToken();
        this.reconnects.push({ token, connectionId, integration });
        return sessionCreated(token);
      }),
    ];
  }
}

const newToken = () => `nango_connect_session_${randomUUID()}`;

// A created session: valid for 30 minutes, with a hosted link to Connect UI.
function sessionCreated(token: string) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const connectLink = `https://connect.nango.dev?session_token=${token}`;
  return HttpResponse.json(
    { data: { token, connect_link: connectLink, expires_at: expiresAt } },
    { status: 201 },
  );
}

/**
 * A session's tags as Nango validates them (packages/shared/lib/services/tags/schema.ts): at
 * most 10, keys starting with a letter and at most 64 characters, lowercased; values 1 to 255
 * characters; `end_user_email` an email address. Undefined when Nango would answer 400.
 */
function nangoTags(tags: Record<string, string> | undefined): Record<string, string> | undefined {
  const entries = Object.entries(tags ?? {}).map(([key, value]): [string, string] => [
    key.toLowerCase(),
    value,
  ]);
  const valid =
    entries.length <= 10 &&
    new Set(entries.map(([key]) => key)).size === entries.length &&
    entries.every(
      ([key, value]) =>
        /^[a-z][a-z0-9_\-./]{0,63}$/.test(key) &&
        value.length >= 1 &&
        value.length <= 255 &&
        (key !== "end_user_email" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)),
    );
  return valid ? Object.fromEntries(entries) : undefined;
}
