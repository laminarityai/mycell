// The isolation suite. Every function a feature's server.ts exports needs a case in that
// feature's tests/isolation-cases.ts, and this file runs every case against the two-org
// fixture. Reaching into features' tests/ folders is this suite's job; nothing else does it.
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  entryFunctionNames,
  type FeatureIsolationCases,
  type IsolationCase,
} from "../testing/isolation";
import { resetDatabase } from "../testing/reset";
import { seedTwoOrgs } from "../testing/two-org-fixture";

const featuresDir = new URL("../../features/", import.meta.url);

type Feature = { name: string; server: object; isolation: FeatureIsolationCases | undefined };

async function loadFeatures(): Promise<Feature[]> {
  const names = readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const features: Feature[] = [];
  for (const name of names) {
    const server = await importIfExists<object>(`${name}/server.ts`);
    if (server === undefined) continue;
    const cases = await importIfExists<{ isolationCases: FeatureIsolationCases }>(
      `${name}/tests/isolation-cases.ts`,
    );
    features.push({ name, server, isolation: cases?.isolationCases });
  }
  return features;
}

// Resolved at run time, not by Vite's static dynamic-import analysis, which caches the list
// of matching files and so would miss a newly added feature.
async function importIfExists<T>(path: string): Promise<T | undefined> {
  const url = new URL(path, featuresDir);
  if (!existsSync(url)) return undefined;
  return (await import(/* @vite-ignore */ url.href)) as T;
}

const features = await loadFeatures();

describe("isolation coverage", () => {
  it("has an isolation case for every server entry function", () => {
    const missing = features.flatMap(({ name, server, isolation }) =>
      entryFunctionNames(server)
        .filter((fn) => isolation?.cases[fn] === undefined)
        .map((fn) => `${name}/server.ts ${fn}()`),
    );
    expect(missing, "add a case to the feature's tests/isolation-cases.ts").toEqual([]);
  });
});

const featuresWithCases = features.flatMap(({ name, isolation }) =>
  isolation === undefined ? [] : [{ name, isolation }],
);

describe.each(featuresWithCases)("$name isolation", ({ isolation }) => {
  const cases = Object.entries(isolation.cases).filter(
    (entry): entry is [string, IsolationCase] => entry[1] !== undefined,
  );
  for (const [fn, isolationCase] of cases) {
    if (typeof isolationCase === "function") {
      it(`${fn}() stays inside the caller's org`, async () => {
        await resetDatabase();
        await isolationCase(await seedTwoOrgs());
      });
    } else {
      it.skip(`${fn}() is not tenant-scoped: ${isolationCase.notTenantScoped}`);
    }
  }
});
