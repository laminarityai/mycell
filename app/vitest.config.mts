import { defineConfig } from "vitest/config";
import { checkoutIsolation } from "./checkout-isolation";

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

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/db/testing/global-setup.ts"],
    setupFiles: ["src/db/testing/reset-before-each-file.ts", "src/testing/fake-services-setup.ts"],
    // Test files share one database and each starts by emptying it, so they run one at a time.
    fileParallelism: false,
  },
});
