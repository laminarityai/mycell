// `pnpm nango:preflight`: checks the Nango and Inngest setup in app/.env before the dogfood
// check (docs/runbooks/m1-dogfood.md). Prints PASS or FAIL per check, never a secret, and exits
// non-zero when any check fails. Env is read through src/env.ts, like the app.
import { formatResults, runPreflight } from "./nango-preflight-checks.ts";

async function main(): Promise<number> {
  let env;
  try {
    ({ env } = await import("../src/env.ts"));
  } catch (error) {
    // Name what's wrong with app/.env without echoing any value.
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    console.error("FAIL  app/.env doesn't parse:");
    for (const issue of issues ?? []) {
      console.error(`  ${issue.path.map(String).join(".")}: ${issue.message}`);
    }
    if (issues === undefined) console.error("  (not an env schema error)");
    return 1;
  }
  const results = await runPreflight({
    nangoApiKey: env.NANGO_API_KEY,
    webhookSigningKey: env.NANGO_WEBHOOK_SIGNING_KEY,
    inngestDev: env.INNGEST_DEV,
    inngestEventKey: env.INNGEST_EVENT_KEY,
    inngestSigningKey: env.INNGEST_SIGNING_KEY,
  });
  console.log(formatResults(results));
  return results.every((result) => result.ok) ? 0 : 1;
}

process.exitCode = await main();
