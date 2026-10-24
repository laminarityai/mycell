// Shapes of the demo console's sample data. Nothing here is stored or read from the database;
// see `data.ts`.

export type DemoGroup = { id: number; name: string; parentId: number | null; budget: number };

export type DemoMember = { id: number; name: string; group: string; joinedDaysAgo: number };

export type DemoAgent = {
  slug: string;
  name: string;
  description: string;
  group: string;
  connections: string[];
  status: "Running" | "Paused" | "Needs review";
};

export type DemoRequest = {
  id: number;
  member: number;
  agent: string;
  model: string;
  provider: string;
  task: string;
  summary: string;
  /** Days before the demo's fixed "today". */
  day: number;
  tokens: number;
  latencyMs: number;
  cost: number;
  /** What the same work would have cost on the default model, without routing. */
  baseline: number;
};

export type DemoModel = { id: string; label: string; provider: string };

export type DemoRoute = {
  id: number;
  name: string;
  strategy: string;
  fallback: boolean;
  maxCost: number;
  enabled: boolean;
};

/** One row of a usage leaderboard: a model or an agent, with its daily totals. */
export type UsageRow = {
  name: string;
  subtitle: string;
  requests: number[];
  tokens: number[];
  spend: number[];
  latencyMs: number;
  baseline: number;
};
