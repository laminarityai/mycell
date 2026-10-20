import { defineConfig, devices } from "@playwright/test";
import { checkoutIsolation } from "./checkout-isolation";

// End-to-end tests drive the production build (`pnpm build` first; `pnpm verify` builds before
// it runs them) against their own database, never the one in .env or Vitest's: mycel_e2e_<suffix>,
// named for this checkout. A port of its own (3100-3999, also derived from the checkout) keeps
// them clear of a running `pnpm dev` and of another worktree's run. E2E_DATABASE_URL and E2E_PORT
// override them.
const { e2eDatabaseUrl, e2ePort: port } = checkoutIsolation(__dirname);
const e2eEnv = {
  DATABASE_URL: e2eDatabaseUrl,
  // The tests sign browsers in by signing a session cookie with this secret (e2e/sign-in-as.ts),
  // so they never reach Google and the placeholders satisfy the env schema.
  BETTER_AUTH_SECRET: "e2e-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: `http://localhost:${String(port)}`,
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  NANGO_API_KEY: "e2e-nango-api-key",
  NANGO_WEBHOOK_SIGNING_KEY: "e2e-nango-webhook-signing-key",
};
// The test workers seed that database and sign cookies through src/env, like the app does.
Object.assign(process.env, e2eEnv);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Tests share one database and each starts by emptying it, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: e2eEnv.BETTER_AUTH_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next start --port ${String(port)}`,
    url: e2eEnv.BETTER_AUTH_URL,
    env: e2eEnv,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
