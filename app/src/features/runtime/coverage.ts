// Which catalog actions and step types runtime can execute yet; the rest are pending. Pure, so
// it isn't in server.ts: a test checks it against the catalog and the spec's step types.
import { actionExecutors } from "./lib/actions";
import { stepExecutors } from "./lib/executors";
import type { ExecutorCoverage } from "./types";

export const executorCoverage: ExecutorCoverage = {
  actions: statuses(actionExecutors),
  steps: statuses(stepExecutors),
};

function statuses<K extends string>(registry: Record<K, { status: "ready" | "pending" }>) {
  const entries = Object.entries<{ status: "ready" | "pending" }>(registry);
  return Object.fromEntries(entries.map(([name, entry]) => [name, entry.status])) as Record<
    K,
    "ready" | "pending"
  >;
}
