// The checks `pnpm nango:preflight` runs before the dogfood check (docs/runbooks/m1-dogfood.md):
// does the Nango API key work, does the Google integration exist under the ID Mycel uses,
// is the webhook signing key a real one, and is Inngest set up for the local dev server. Each
// result's detail is fixed text: no check ever echoes a key or a response body.
//
// Run by Node itself (type stripping), so this file imports nothing through the `@/` alias.
import { z } from "zod";

const NANGO_API_URL = "https://api.nango.dev";

/**
 * Mycel's integrations, by ID (provider config key), each expected on its own provider: every
 * registered app's (connections/registered-apps.ts, which this script can't import), starting
 * with the one Google integration that every new Google connection uses (ADR-0014). The one-app
 * `google-mail` and `google-drive` serve only connections made before it.
 */
export const EXPECTED_INTEGRATIONS = ["google", "pipedrive"] as const;

/** What the checks read: the env values that matter, as src/env.ts parsed them. */
export type PreflightConfig = {
  nangoApiKey: string;
  webhookSigningKey: string;
  inngestDev: boolean;
  inngestEventKey: string | undefined;
  inngestSigningKey: string | undefined;
};

export type CheckResult = { name: string; ok: boolean; detail: string };

// Values that only ever stand in for a real signing key: the tests' and the usual fillers.
const PLACEHOLDER_SIGNING_KEYS = /^(test-nango-webhook-signing-key|changeme|placeholder|x+|todo)$/i;

const integrationResponse = z.object({
  data: z.object({
    unique_key: z.string(),
    provider: z.string(),
    missing_fields: z.array(z.string()).optional(),
  }),
});

export async function runPreflight(config: PreflightConfig): Promise<CheckResult[]> {
  const apiKey = await checkApiKey(config.nangoApiKey);
  const integrations = [];
  for (const id of EXPECTED_INTEGRATIONS) {
    integrations.push(await checkIntegration(config.nangoApiKey, id));
  }
  return [apiKey, ...integrations, checkSigningKey(config), checkInngest(config)];
}

// The cheapest authenticated call that the app's own key must be allowed anyway: the nightly
// reconciliation lists connections.
async function checkApiKey(apiKey: string): Promise<CheckResult> {
  const name = "Nango API key";
  const response = await nangoGet(apiKey, "/connections?limit=1&page=0");
  if (response === "unreachable") return fail(name, "couldn't reach api.nango.dev");
  // The listing is never read.
  await response.body?.cancel();
  if (response.ok) return pass(name, "accepted (it can list connections)");
  if (response.status === 401) {
    return fail(
      name,
      "Nango rejected it: copy NANGO_API_KEY from the dev environment's Environment Settings > API Keys",
    );
  }
  if (response.status === 403) {
    return fail(name, "the key lacks the scope environment:connections:list");
  }
  return fail(name, `Nango answered ${String(response.status)}`);
}

async function checkIntegration(apiKey: string, id: string): Promise<CheckResult> {
  const name = `Integration ${id}`;
  const response = await nangoGet(apiKey, `/integrations/${encodeURIComponent(id)}`);
  if (response === "unreachable") return fail(name, "couldn't reach api.nango.dev");
  if (response.status === 404) {
    return fail(name, `not found: create it with the integration ID exactly "${id}"`);
  }
  if (response.status === 401) return fail(name, "skipped: Nango rejected the API key");
  if (response.status === 403) {
    return fail(name, "the key lacks the scope environment:integrations:read");
  }
  if (!response.ok) return fail(name, `Nango answered ${String(response.status)}`);
  const parsed = integrationResponse.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) return fail(name, "Nango's answer wasn't an integration");
  const { provider, missing_fields: missing = [] } = parsed.data.data;
  if (provider !== id) {
    return fail(name, `uses the provider "${provider}"; Mycel expects "${id}"`);
  }
  if (missing.length > 0) {
    return fail(name, `missing configuration: ${missing.join(", ")}`);
  }
  return pass(name, `exists, on the provider "${provider}"`);
}

function checkSigningKey(config: PreflightConfig): CheckResult {
  const name = "Webhook signing key";
  const key = config.webhookSigningKey.trim();
  if (key === "") return fail(name, "NANGO_WEBHOOK_SIGNING_KEY is empty");
  if (PLACEHOLDER_SIGNING_KEYS.test(key)) {
    return fail(name, "NANGO_WEBHOOK_SIGNING_KEY is a placeholder");
  }
  if (key === config.nangoApiKey.trim()) {
    return fail(
      name,
      "NANGO_WEBHOOK_SIGNING_KEY is the API key: use Environment Settings > Webhooks > Signing key",
    );
  }
  return pass(name, "set, and not the API key");
}

// The dogfood run sends events to the local dev server, which needs no keys.
function checkInngest(config: PreflightConfig): CheckResult {
  const name = "Inngest";
  if (!config.inngestDev) {
    return fail(name, "INNGEST_DEV isn't 1: the dogfood check runs on the local dev server");
  }
  const unused = [
    ...(config.inngestEventKey === undefined ? [] : ["INNGEST_EVENT_KEY"]),
    ...(config.inngestSigningKey === undefined ? [] : ["INNGEST_SIGNING_KEY"]),
  ];
  return pass(
    name,
    unused.length === 0
      ? "INNGEST_DEV=1, so events go to the dev server at localhost:8288"
      : `INNGEST_DEV=1; ${unused.join(" and ")} set but unused in dev mode`,
  );
}

async function nangoGet(apiKey: string, path: string): Promise<Response | "unreachable"> {
  try {
    return await fetch(`${NANGO_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "unreachable";
  }
}

const pass = (name: string, detail: string): CheckResult => ({ name, ok: true, detail });
const fail = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });

/** The results, one line each, as the script prints them. */
export function formatResults(results: CheckResult[]): string {
  const lines = results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  lines.push(failed === 0 ? "All checks passed." : `${String(failed)} check(s) failed.`);
  return lines.join("\n");
}
