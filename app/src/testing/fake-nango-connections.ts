// The fake Nango's connections API: listing connections, and reading one by ID, in the shapes
// Nango documents. Pages are numbered from 0 and the listing ends at an empty page.
import { http, HttpResponse } from "msw";
import type { FakeConnection } from "./fake-nango";
import { authorised, NANGO_API as API, unauthorised } from "./fake-nango-http";

// Nango's own cap on a page, and its default when no limit is asked.
const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 10_000;

/** How the list endpoint misbehaves, as a test asks. */
export type ListingBehaviour = {
  // Pages hold at most this many, whatever the request's limit.
  pageCap: number | undefined;
  // Answer every page with no connections.
  empty: boolean;
};

export function connectionsApiHandlers(
  all: () => FakeConnection[],
  behaviour: () => ListingBehaviour,
) {
  return [
    http.get(`${API}/connections`, ({ request }) => {
      if (!authorised(request)) return unauthorised();
      const params = new URL(request.url).searchParams;
      const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
      const page = Number(params.get("page") ?? 0);
      if (!Number.isInteger(page) || page < 0 || !(limit >= 1 && limit <= MAX_LIMIT)) {
        return HttpResponse.json({ error: { code: "invalid_query_params" } }, { status: 400 });
      }
      const { pageCap, empty } = behaviour();
      const connectionId = params.get("connectionId");
      const tagFilters = [...params.entries()].flatMap(([key, value]) => {
        const tag = /^tags\[(.+)\]$/.exec(key)?.[1];
        return tag === undefined ? [] : [[tag.toLowerCase(), value] as const];
      });
      const matching = (empty ? [] : all())
        .filter((c) => connectionId === null || c.connectionId === connectionId)
        .filter((c) => tagFilters.every(([tag, value]) => c.tags[tag] === value))
        .sort((a, b) => a.id - b.id);
      const size = Math.min(limit, pageCap ?? limit);
      const served = matching.slice(page * size, (page + 1) * size);
      return HttpResponse.json({ connections: served.map(listed) });
    }),

    http.get(`${API}/connections/:connectionId`, ({ request, params }) => {
      if (!authorised(request)) return unauthorised();
      const key = new URL(request.url).searchParams.get("provider_config_key");
      const connection = all().find((c) => c.connectionId === String(params.connectionId));
      if (connection === undefined || connection.integration !== key) {
        const error = { code: "not_found", message: "Failed to find connection" };
        return HttpResponse.json({ error }, { status: 404 });
      }
      // The full connection, which names its times as created_at and updated_at (the listing
      // says `created`). `raw` is the app's whole token response, whose `scope` lists what was
      // granted: space-separated for Google, comma-separated for Pipedrive (unverified), whose
      // response also names the company's `api_domain`, which Nango keeps as connection config.
      const { created, ...rest } = listed(connection);
      const pipedrive = connection.integration === "pipedrive";
      const apiDomain = pipedrive ? { api_domain: connection.pipedrive.apiDomain } : {};
      return HttpResponse.json({
        ...rest,
        connection_config: apiDomain,
        created_at: created,
        updated_at: created,
        last_fetched_at: null,
        credentials: {
          type: "OAUTH2",
          access_token: "fake-access-token",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          raw: {
            access_token: "fake-access-token",
            expires_in: 3599,
            scope: connection.scopes.join(pipedrive ? "," : " "),
            token_type: "Bearer",
            ...apiDomain,
          },
        },
      });
    }),
  ];
}

// A connection as the list endpoint shows it: no credentials.
function listed(connection: FakeConnection) {
  return {
    id: connection.id,
    connection_id: connection.connectionId,
    provider: connection.integration,
    provider_config_key: connection.integration,
    created: connection.created,
    metadata: null,
    tags: connection.tags,
    errors: [],
  };
}
