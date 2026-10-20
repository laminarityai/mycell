// The source APIs the fake Nango's proxy serves, by path prefix: each answers from the
// connection's own fake (its Gmail mailbox or its Drive), and says how it rate-limits. Like
// Nango, a connection reaches only its own integration's API: a Gmail connection asking for a
// Drive path gets the 404 Gmail's host would give it.
import { HttpResponse } from "msw";
import { driveError, driveResponse } from "./fake-drive";
import { gmailError, gmailResponse } from "./fake-gmail";
import type { FakeConnection } from "./fake-nango";

type Respond = (connection: FakeConnection, path: string, params: URLSearchParams) => Response;

export type ProxiedSource = { prefix: string; respond: Respond; rateLimited: () => Response };

function servedTo(integration: string, respond: Respond): Respond {
  return (connection, path, params) =>
    connection.integration === integration
      ? respond(connection, path, params)
      : HttpResponse.json({ error: { code: 404, message: "Not Found" } }, { status: 404 });
}

export const PROXIED_SOURCES: ProxiedSource[] = [
  {
    prefix: "/gmail/v1/users/me",
    respond: servedTo("google-mail", (connection, path, params) =>
      gmailResponse(connection.mailbox, path, params),
    ),
    rateLimited: () => gmailError(429, "RESOURCE_EXHAUSTED"),
  },
  {
    prefix: "/drive/v3",
    respond: servedTo("google-drive", (connection, path, params) =>
      driveResponse(connection.drive, path, params),
    ),
    rateLimited: () => driveError(429),
  },
];
