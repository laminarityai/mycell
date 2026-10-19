// Isolation cases: each feature's tests/isolation-cases.ts names a case for every function its
// server.ts exports. src/db/tests/isolation.test.ts runs them all and fails when one is missing.
import type { TwoOrgs } from "./two-org-fixture";

/** Proves, starting from fresh two-org data, that an entry function stays inside its org. */
export type IsolationTest = (orgs: TwoOrgs) => Promise<void>;

/** An explicit, reviewable claim that an entry function touches no org data. */
export type NotTenantScoped = { readonly notTenantScoped: string };

export type IsolationCase = IsolationTest | NotTenantScoped;

type EntryFunctionName<M> = {
  [K in keyof M]: M[K] extends (...args: never[]) => unknown ? K : never;
}[keyof M] &
  string;

export type IsolationCases<M> = { [K in EntryFunctionName<M>]: IsolationCase };

export type FeatureIsolationCases = {
  server: object;
  cases: Partial<Record<string, IsolationCase>>;
};

export function defineIsolationCases<M extends object>(
  server: M,
  cases: IsolationCases<M>,
): FeatureIsolationCases {
  return { server, cases };
}

export function notTenantScoped(reason: string): NotTenantScoped {
  return { notTenantScoped: reason };
}

export function entryFunctionNames(server: object): string[] {
  return Object.entries(server)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
}
