// Per-checkout names for the test databases and the e2e port, so `pnpm verify` in two worktrees
// at once never shares state. vitest.config.mts and playwright.config.ts import it, and pass
// their own directory, which is different in every checkout.
import { createHash } from "node:crypto";

const TEST_DATABASE_HOST = "postgres://mycel:mycel@localhost:5433";
const E2E_PORT_BASE = 3100;
const E2E_PORT_RANGE = 900;

export interface CheckoutIsolation {
  testDatabaseUrl: string;
  e2eDatabaseUrl: string;
  e2ePort: number;
}

// TEST_DATABASE_URL, E2E_DATABASE_URL and E2E_PORT override the derived values.
export function checkoutIsolation(appDir: string): CheckoutIsolation {
  const suffix = createHash("sha256").update(appDir).digest("hex").slice(0, 8);
  const derivedPort = E2E_PORT_BASE + (Number.parseInt(suffix, 16) % E2E_PORT_RANGE);
  return {
    testDatabaseUrl: process.env.TEST_DATABASE_URL ?? `${TEST_DATABASE_HOST}/mycel_test_${suffix}`,
    e2eDatabaseUrl: process.env.E2E_DATABASE_URL ?? `${TEST_DATABASE_HOST}/mycel_e2e_${suffix}`,
    e2ePort: process.env.E2E_PORT ? Number(process.env.E2E_PORT) : derivedPort,
  };
}
