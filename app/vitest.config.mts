import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { checkoutIsolation } from "./checkout-isolation";

// Required at runtime rather than imported, so loading this config doesn't bundle the loader.
const { promptModule } = createRequire(import.meta.url)("./prompt-loader.cjs") as {
  promptModule: (source: string) => string;
};

// Tests use their own database on the local Postgres (`pnpm db:up`) or the CI service
// container, never the one in .env: mycel_test_<suffix>, named for this checkout so parallel
// worktrees don't share it. TEST_DATABASE_URL overrides it.
process.env.DATABASE_URL = checkoutIsolation(import.meta.dirname).testDatabaseUrl;
// Tests never reach Google or issue real sessions, so placeholders satisfy the env schema.
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
// Tests talk to the fake Nango (src/testing/fake-nango.ts), which checks the API key and signs
// its webhooks with the signing key.
process.env.NANGO_API_KEY = "test-nango-api-key";
process.env.NANGO_WEBHOOK_SIGNING_KEY = "test-nango-webhook-signing-key";
// Tests never run Inngest: sending an event reaches the fake Inngest (src/testing/fake-inngest.ts)
// at Inngest Cloud's event URL, which records it.
process.env.INNGEST_DEV = "0";
process.env.INNGEST_EVENT_KEY = "test-inngest-event-key";
process.env.INNGEST_SIGNING_KEY = "signkey-test-00000000000000000000000000000000";
process.env.INNGEST_ENCRYPTION_KEY = "test-inngest-encryption-key-of-32-chars-at-least";
// Model calls reach the fake AI Gateway (src/testing/fake-ai-gateway.ts), which checks the key.
process.env.AI_GATEWAY_API_KEY = "test-ai-gateway-api-key";
process.env.MODEL_CLASSIFY = "typesafe-ai/jev-1.14.0";
process.env.MODEL_FAST = "test/fast-default";
process.env.MODEL_SMART = "test/smart-default";
process.env.MODEL_JUDGE = "test/judge-default";
process.env.MODEL_EMBED = "test/embed-default";
// The injection screen reaches the fake Model Armor (src/testing/fake-model-armor.ts), which also
// plays Google's token exchange: it accepts this Vercel OIDC token (an unsigned JWT that expires
// in 2100) for this pool provider and service account.
process.env.MODEL_ARMOR_TEMPLATE = "projects/mycel-test/locations/us/templates/mycel-memory";
process.env.GCP_WORKLOAD_IDENTITY_PROVIDER =
  "projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel";
process.env.GCP_SERVICE_ACCOUNT_EMAIL = "mycel-screen@mycel-test.iam.gserviceaccount.com";
process.env.VERCEL_OIDC_TOKEN = [
  { alg: "none", typ: "JWT" },
  { sub: "owner:mycel:project:app:environment:test", exp: 4_102_444_800 },
]
  .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
  .concat("signature")
  .join(".");
// The key store reaches the fake KMS (src/testing/fake-kms.ts) at AWS's regional endpoint, and
// the fake checks requests are signed with this access key.
process.env.KMS_REGION = "us-east-1";
process.env.KMS_ACCESS_KEY_ID = "test-kms-access-key-id";
process.env.KMS_SECRET_ACCESS_KEY = "test-kms-secret-access-key";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Prompt files load as Turbopack bundles them (next.config.ts).
  plugins: [
    {
      name: "prompt-files",
      transform(source, id) {
        return id.endsWith(".prompt.yml") ? { code: promptModule(source), map: null } : undefined;
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["src/db/testing/global-setup.ts"],
    setupFiles: ["src/db/testing/reset-before-each-file.ts", "src/testing/fake-services-setup.ts"],
    // Test files share one database and each starts by emptying it, so they run one at a time.
    fileParallelism: false,
    // The tests run against real Postgres, so a busy machine (several checkouts verifying at
    // once) can take a test past Vitest's 5-second default without anything being wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
