// PROTOTYPE, throwaway: one consistent fake company that every prototype draws from, so the
// Credits page, the Runs page, alerts and Ask Mycel all tell the same story. Pages may add their
// own fixtures beside their variants; shared facts belong here.

/** "Now" for every prototype, so ages and runways read the same everywhere. */
export const NOW = new Date("2026-10-22T14:05:00Z");

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (d: number) => minutesAgo(d * 24 * 60);

export const ORG = { name: "Fernhill Supply Co.", domain: "fernhill.co" };

export type Person = { id: string; name: string; email: string; role: "admin" | "member" };

export const PEOPLE = {
  dana: { id: "u-dana", name: "Dana Ruiz", email: "dana@fernhill.co", role: "admin" },
  priya: { id: "u-priya", name: "Priya Shah", email: "priya@fernhill.co", role: "member" },
  tom: { id: "u-tom", name: "Tom Becker", email: "tom@fernhill.co", role: "member" },
  sam: { id: "u-sam", name: "Sam Okafor", email: "sam@fernhill.co", role: "member" },
} satisfies Record<string, Person>;

/** Who the `as` toggle signs in as: Dana for admin, Priya for member. */
export const viewerFor = (as: string): Person => (as === "member" ? PEOPLE.priya : PEOPLE.dana);

export type Connection = {
  id: string;
  label: string;
  kind: "member" | "org";
  ownerId?: string;
  status: "active" | "needs_reconnect" | "backfill_failed";
  since?: Date;
};

export const CONNECTIONS: Connection[] = [
  { id: "c-dana", label: "dana@fernhill.co", kind: "member", ownerId: "u-dana", status: "active" },
  {
    id: "c-priya",
    label: "priya@fernhill.co",
    kind: "member",
    ownerId: "u-priya",
    status: "active",
  },
  {
    id: "c-tom",
    label: "tom@fernhill.co",
    kind: "member",
    ownerId: "u-tom",
    status: "needs_reconnect",
    since: daysAgo(2),
  },
  { id: "c-sam", label: "sam@fernhill.co", kind: "member", ownerId: "u-sam", status: "active" },
  { id: "c-orders", label: "orders@fernhill.co", kind: "org", status: "active" },
  {
    id: "c-invoices",
    label: "invoices@fernhill.co",
    kind: "org",
    status: "backfill_failed",
    since: minutesAgo(190),
  },
];

/** M7's order: the first reason that holds is the one shown. */
export type PausedReason = "out_of_credits" | "failures" | "budget_reached" | "needs_reenable";

export const PAUSED_TEXT: Record<PausedReason, string> = {
  out_of_credits: "out of credits",
  failures: "failing, an admin will look at it",
  budget_reached: "budget reached",
  needs_reenable: "needs your OK for a riskier version",
};

export type Workflow = {
  id: string;
  name: string;
  apps: string[];
  credentials: "member" | "org";
  version: number;
  /** Monthly credit budget; none means only the balance limits it. */
  budget: number | null;
  spentThisMonth: number;
  paused: PausedReason | null;
  pausedSince?: Date;
  /** For a failure pause, the three runs that caused it. */
  pausedByRunIds?: string[];
  tags: string[];
};

export const WORKFLOWS: Workflow[] = [
  {
    id: "wf-quotes",
    name: "Reply to quote requests",
    apps: ["Gmail", "Sheets"],
    credentials: "member",
    version: 7,
    budget: 2000,
    spentThisMonth: 1452,
    paused: null,
    tags: ["Sales"],
  },
  {
    id: "wf-invoices",
    name: "Label supplier invoices",
    apps: ["Gmail"],
    credentials: "org",
    version: 3,
    budget: null,
    spentThisMonth: 388,
    paused: null,
    tags: ["Finance"],
  },
  {
    id: "wf-calls",
    name: "Book customer calls",
    apps: ["Gmail", "Calendar"],
    credentials: "member",
    version: 2,
    budget: 800,
    spentThisMonth: 812,
    paused: "budget_reached",
    pausedSince: daysAgo(1),
    tags: ["Sales"],
  },
  {
    id: "wf-status",
    name: "Weekly status into the ops doc",
    apps: ["Gmail", "Docs"],
    credentials: "org",
    version: 4,
    budget: 300,
    spentThisMonth: 96,
    paused: null,
    tags: ["Ops"],
  },
  {
    id: "wf-followups",
    name: "Follow-up tasks from orders",
    apps: ["Gmail", "Tasks"],
    credentials: "member",
    version: 5,
    budget: null,
    spentThisMonth: 241,
    paused: "failures",
    pausedSince: minutesAgo(95),
    pausedByRunIds: ["r-1004", "r-1009", "r-1014"],
    tags: ["Ops"],
  },
];

export const workflowById = (id: string) => WORKFLOWS.find((w) => w.id === id);

export type RunStatus =
  "succeeded" | "failed" | "partly_failed" | "escalated" | "skipped" | "cancelled" | "running";

export type Run = {
  id: string;
  workflowId: string;
  connectionId: string;
  status: RunStatus;
  startedAt: Date;
  durationMs: number;
  cost: number;
  startedBy: "trigger" | "retry" | "agent" | "admin";
  failedStep?: string;
  errorCode?: string;
  errorText?: string;
  subject?: string;
  from?: string;
};

const FAILURE = {
  "wf-followups": {
    failedStep: "extract-order",
    errorCode: "check_failed_schema",
    errorText: "The model's answer didn't fit the schema (missing order_number).",
  },
  "wf-quotes": {
    failedStep: "lookup-price",
    errorCode: "source_forbidden",
    errorText: "Google refused access to the price sheet: reconnect Google or share the sheet.",
  },
} as const;

const SUBJECTS = [
  ["Quote for 400 kraft mailers?", "buyer@acme.com"],
  ["Invoice #88213 — October", "ar@brightlinefoods.com"],
  ["Can we get a call Thursday?", "lena@northwind.io"],
  ["Order 5521 confirmed", "orders@acme.com"],
  ["Re: pallet pricing", "jo@harborgoods.com"],
  ["Weekly numbers", "ops@fernhill.co"],
] as const;

/** 40 runs, newest first, across workflows and connections. */
export const RUNS: Run[] = Array.from({ length: 40 }, (_, i): Run => {
  const wf = WORKFLOWS[i % WORKFLOWS.length];
  const conn =
    wf.credentials === "org"
      ? wf.id === "wf-invoices"
        ? "c-invoices"
        : "c-orders"
      : ["c-priya", "c-dana", "c-tom", "c-sam"][i % 4];
  const failing = wf.id === "wf-followups" && i < 15;
  const status: RunStatus =
    i === 0
      ? "running"
      : failing
        ? i % 2 === 0
          ? "failed"
          : "partly_failed"
        : (["succeeded", "succeeded", "escalated", "succeeded", "skipped"][i % 5] as RunStatus);
  const [subject, from] = SUBJECTS[i % SUBJECTS.length];
  const failure =
    status === "failed" || status === "partly_failed"
      ? FAILURE[wf.id as keyof typeof FAILURE]
      : undefined;
  return {
    id: `r-${String(1000 + i)}`,
    workflowId: wf.id,
    connectionId: conn,
    status,
    startedAt: minutesAgo(i * 37 + 3),
    durationMs: 1800 + ((i * 733) % 9000),
    cost: status === "skipped" ? 1 : 6 + ((i * 7) % 23),
    startedBy: i === 4 ? "agent" : i === 9 ? "retry" : "trigger",
    subject,
    from,
    ...failure,
  };
});

export type LedgerEntry = {
  id: string;
  at: Date;
  kind: "grant" | "usage" | "correction";
  credits: number;
  note?: string;
  workflowId?: string;
  purpose?: "run" | "try_it" | "builder" | "memory" | "agent" | "injection_screen";
  role?: "classify" | "fast" | "smart" | "judge" | "embed";
  model?: string;
  failed?: boolean;
};

export const CREDITS = {
  balance: 3420,
  /** At the last 7 days' average daily usage. */
  runwayDays: 9,
  dailyAverage7d: 371,
  /**
   * This calendar month (UTC), by group. With the 10,000 October grant on Oct 1 and nothing
   * carried over, 10,000 − 6,580 spent = the 3,420 balance. Workflows is the sum of WORKFLOWS'
   * spentThisMonth.
   */
  monthByGroup: {
    workflows: 2989,
    memory: 2050,
    builder: 860,
    try_it: 312,
    agent: 331,
    injection_screen: 38,
  },
  lowThresholdDays: 7,
};

export const LEDGER: LedgerEntry[] = [
  ...[
    ["wf-quotes", "run", "smart", "anthropic/claude-sonnet-5-5", 14],
    ["wf-invoices", "run", "classify", "jev/jev-classify-2", 2],
    [undefined, "memory", "fast", "anthropic/claude-haiku-4-5", 9],
    ["wf-followups", "run", "fast", "anthropic/claude-haiku-4-5", 4],
    [undefined, "agent", "smart", "anthropic/claude-sonnet-5-5", 11],
    [undefined, "builder", "smart", "anthropic/claude-opus-5-5", 38],
    ["wf-quotes", "try_it", "smart", "anthropic/claude-sonnet-5-5", 13],
    [undefined, "injection_screen", "classify", "google/model-armor", 1],
  ].map(([workflowId, purpose, role, model, credits], i): LedgerEntry => ({
    id: `l-${String(i)}`,
    at: minutesAgo(i * 22 + 4),
    kind: "usage",
    credits: -(credits as number),
    workflowId: workflowId as string | undefined,
    purpose: purpose as LedgerEntry["purpose"],
    role: role as LedgerEntry["role"],
    model: model as string,
  })),
  {
    id: "l-corr",
    at: minutesAgo(200),
    kind: "correction",
    credits: -6,
    workflowId: "wf-followups",
    purpose: "run",
    role: "fast",
    model: "anthropic/claude-haiku-4-5",
    failed: true,
    note: "Failed call billed by the gateway",
  },
  { id: "l-grant", at: daysAgo(21), kind: "grant", credits: 10000, note: "October allowance" },
  { id: "l-grant-2", at: daysAgo(52), kind: "grant", credits: 8000, note: "September allowance" },
];

export const FIXTURE_COUNTS = { waitingReviews: 6, openAlerts: 4 };
