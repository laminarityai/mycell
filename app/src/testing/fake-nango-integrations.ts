// The fake Nango's integrations API: reading one integration by its ID (unique key), in the
// shape Nango documents (GET /integrations/{uniqueKey}). Only the preflight script calls it.
import { http, HttpResponse } from "msw";
import { authorised, NANGO_API, unauthorised } from "./fake-nango-http";

/** An integration as the environment holds it: its ID, its provider, and unset config. */
export type FakeIntegration = { uniqueKey: string; provider: string; missingFields: string[] };

// The environment Mycel expects: the one Google integration (ADR-0014), the two one-app
// integrations that connections from before it still use, and each other registered app's,
// each under its provider's name.
const DEFAULT_INTEGRATIONS: FakeIntegration[] = [
  { uniqueKey: "google", provider: "google", missingFields: [] },
  { uniqueKey: "pipedrive", provider: "pipedrive", missingFields: [] },
  { uniqueKey: "google-mail", provider: "google-mail", missingFields: [] },
  { uniqueKey: "google-drive", provider: "google-drive", missingFields: [] },
];

export class FakeIntegrations {
  private integrations = new Map<string, FakeIntegration>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.integrations = new Map(DEFAULT_INTEGRATIONS.map((i) => [i.uniqueKey, { ...i }]));
  }

  /** Adds or replaces an integration. */
  set(integration: FakeIntegration): void {
    this.integrations.set(integration.uniqueKey, integration);
  }

  /** Deletes the integration, as from Nango's dashboard. */
  remove(uniqueKey: string): void {
    this.integrations.delete(uniqueKey);
  }

  readonly handlers = [
    http.get(`${NANGO_API}/integrations/:uniqueKey`, ({ request, params }) => {
      if (!authorised(request)) return unauthorised();
      const integration = this.integrations.get(String(params.uniqueKey));
      if (integration === undefined) {
        return HttpResponse.json(
          { error: { code: "not_found", message: "Integration does not exist" } },
          { status: 404 },
        );
      }
      const time = new Date(0).toISOString();
      return HttpResponse.json({
        data: {
          unique_key: integration.uniqueKey,
          display_name: integration.provider,
          provider: integration.provider,
          logo: `https://app.nango.dev/images/template-logos/${integration.provider}.svg`,
          created_at: time,
          updated_at: time,
          forward_webhooks: true,
          missing_fields: integration.missingFields,
        },
      });
    }),
  ];
}
