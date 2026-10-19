import { defineConfig } from "vitest/config";

// Tests use their own database on the local Postgres (`pnpm db:up`) or the CI service
// container, never the one in .env. TEST_DATABASE_URL overrides it.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://mycel:mycel@localhost:5433/mycel_test";

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
