import { describe, expect, it } from "vitest";
import { env } from "@/env";
import { fakeNango } from "@/testing/fake-nango";
import { registeredApps } from "@/features/connections/registered-apps";
import {
  EXPECTED_INTEGRATIONS,
  formatResults,
  type PreflightConfig,
  runPreflight,
} from "../nango-preflight-checks";

// A setup that should pass: the fake Nango's own API key, and a real-looking signing key.
const READY: PreflightConfig = {
  nangoApiKey: env.NANGO_API_KEY,
  webhookSigningKey: "2f6d0c1e-6c8a-4c55-9a5e-8d1f0b7e3a21",
  inngestDev: true,
  inngestEventKey: undefined,
  inngestSigningKey: undefined,
};

const byName = async (config: PreflightConfig) =>
  Object.fromEntries((await runPreflight(config)).map((r) => [r.name, r]));

describe("nango preflight", () => {
  it("passes every check against a ready environment", async () => {
    const results = await runPreflight(READY);

    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ["Nango API key", true],
      ["Integration google", true],
      ["Integration microsoft", true],
      ["Webhook signing key", true],
      ["Inngest", true],
    ]);
    expect(formatResults(results)).toMatch(/All checks passed\.$/);
  });

  it("checks every registered app's integration", () => {
    expect([...EXPECTED_INTEGRATIONS]).toEqual(registeredApps.map((app) => app.integration));
  });

  it("fails a registered app's missing integration", async () => {
    fakeNango.integrations.remove("microsoft");

    expect((await byName(READY))["Integration microsoft"]).toMatchObject({ ok: false });
  });

  it("fails the key and the integrations when Nango rejects the key", async () => {
    const results = await byName({ ...READY, nangoApiKey: "wrong-key" });

    expect(results["Nango API key"]).toMatchObject({ ok: false, detail: /rejected/ });
    expect(results["Integration google"]).toMatchObject({ ok: false });
  });

  it("fails an integration that's missing, on another provider, or without credentials", async () => {
    fakeNango.integrations.remove("google");
    expect((await byName(READY))["Integration google"]).toMatchObject({
      ok: false,
      detail: /not found/,
    });

    fakeNango.integrations.set({ uniqueKey: "google", provider: "google-mail", missingFields: [] });
    expect((await byName(READY))["Integration google"]).toMatchObject({
      ok: false,
      detail: /provider/,
    });

    fakeNango.integrations.set({
      uniqueKey: "google",
      provider: "google",
      missingFields: ["oauth_client_id"],
    });
    expect((await byName(READY))["Integration google"]).toMatchObject({
      ok: false,
      detail: /missing configuration: oauth_client_id/,
    });
  });

  it("fails a signing key that's empty, the tests' placeholder, or the API key", async () => {
    for (const webhookSigningKey of ["", env.NANGO_WEBHOOK_SIGNING_KEY, READY.nangoApiKey]) {
      const results = await byName({ ...READY, webhookSigningKey });
      expect(results["Webhook signing key"]).toMatchObject({ ok: false });
    }
  });

  it("fails Inngest outside dev mode, and notes cloud keys that dev mode ignores", async () => {
    expect((await byName({ ...READY, inngestDev: false })).Inngest).toMatchObject({ ok: false });
    expect(
      (await byName({ ...READY, inngestEventKey: "evt", inngestSigningKey: "sig" })).Inngest,
    ).toMatchObject({ ok: true, detail: /unused in dev mode/ });
  });

  it("never prints a key", async () => {
    const config = { ...READY, nangoApiKey: "secret-api-key-123" };
    const output = formatResults([
      ...(await runPreflight(config)),
      ...(await runPreflight({ ...READY, webhookSigningKey: READY.nangoApiKey })),
    ]);

    for (const secret of [config.nangoApiKey, READY.nangoApiKey, READY.webhookSigningKey]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toMatch(/check\(s\) failed\.$/);
  });
});
