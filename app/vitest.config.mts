import { defineConfig } from "vitest/config";

// Tests use their own database on the local Postgres (`pnpm db:up`) or the CI service
// container, never the one in .env. TEST_DATABASE_URL overrides it.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://mycel:mycel@localhost:5433/mycel_test";
// Tests never reach Google or issue real sessions, so placeholders satisfy the env schema.
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/db/testing/global-setup.ts"],
    setupFiles: ["src/db/testing/reset-before-each-file.ts"],
    // Test files share one database and each starts by emptying it, so they run one at a time.
    fileParallelism: false,
  },
});
