// PROTOTYPE, throwaway: the four runs the `run` toggle flips between, as `getRun` would return
// them in full: each step with its status, attempts, model, cost, checks, output and error.
import type { Spec } from "@/features/spec/types";
import { NOW, type RunStatus } from "../_shared/fixtures";
import { FOLLOWUPS_SPEC, QUOTES_SPEC } from "./run-specs";
import type { StepCheck, StepError } from "./run-types";

export { CHECK_NAME } from "./run-types";
export type { CheckKind, StepCheck, StepError } from "./run-types";

export type StepStatus = "succeeded" | "failed" | "check_failed" | "not_reached" | "waiting";

export type RunStep = {
  id: string;
  type: "classify" | "branch" | "extract" | "tool" | "draft" | "approval";
  /** What it does, in plain words. */
  does: string;
  /** The path it's on, when inside a branch. */
  path?: string;
  status: StepStatus;
  attempts: number;
  role?: string;
  model?: string;
  cost: number;
  ms: number;
  /** Shown in the full view only. */
  output?: string;
  checks?: StepCheck[];
  error?: StepError;
  /** For a branch: each path, whether it was taken, and why (the why is output). */
  paths?: { id: string; name: string; taken: boolean; why: string }[];
};

export type RunCase = {
  key: string;
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  version: number;
  latestVersion: number;
  spec: Spec;
  startedAt: Date;
  startedBy: "trigger" | "retry" | "agent";
  subject: string;
  from: string;
  steps: RunStep[];
  reviews: { id: string; title: string; state: string }[];
  /** A run-level error, when the run as a whole stopped. */
  error?: StepError;
};

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const HAIKU = "anthropic/claude-haiku-4-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const CLASSIFIER = "jev/jev-classify-2";

const quoteSteps = (tail: RunStep[]): RunStep[] => [
  {
    id: "kind",
    type: "classify",
    does: "Decide whether it asks for a quote",
    status: "succeeded",
    attempts: 1,
    role: "classify",
    model: CLASSIFIER,
    cost: 1,
    ms: 420,
    output: 'Said "quote", 94% sure',
    checks: [{ kind: "confidence", passed: true, says: "94% sure, at least 80% needed" }],
  },
  {
    id: "route",
    type: "branch",
    does: "Pick a path",
    status: "succeeded",
    attempts: 1,
    cost: 0,
    ms: 2,
    paths: [
      { id: "quote", name: "Quote request", taken: true, why: 'kind said "quote", 94% sure' },
      { id: "not-a-quote", name: "Otherwise", taken: false, why: "Not needed" },
    ],
  },
  {
    id: "details",
    type: "extract",
    does: "Pull out the product and quantity",
    path: "Quote request",
    status: "succeeded",
    attempts: 1,
    role: "fast",
    model: HAIKU,
    cost: 3,
    ms: 1310,
    output: "product: kraft mailers 10×13, quantity: 400",
    checks: [
      { kind: "required_fields", passed: true, says: "product and quantity are both there" },
    ],
  },
  ...tail,
];

const LOOKUP_OK: RunStep = {
  id: "lookup-price",
  type: "tool",
  does: "Read the price sheet",
  path: "Quote request",
  status: "succeeded",
  attempts: 1,
  cost: 0,
  ms: 640,
  output: "Read 184 rows from Prices!A1:C200",
};

const REPLY_OK: RunStep = {
  id: "reply",
  type: "draft",
  does: "Write the reply as a Gmail draft",
  path: "Quote request",
  status: "succeeded",
  attempts: 1,
  role: "smart",
  model: SONNET,
  cost: 14,
  ms: 4820,
  output: "Draft saved in the thread: 400 mailers at $0.38 each, ships in 3 days",
};

const notReached = (id: string, type: RunStep["type"], does: string, path: string): RunStep => ({
  id,
  type,
  does,
  path,
  status: "not_reached",
  attempts: 0,
  cost: 0,
  ms: 0,
});

const APPROVAL_NOT_REACHED = notReached(
  "reply-approval",
  "approval",
  "Wait for a person to send the draft",
  "Quote request",
);

export const RUN_CASES: RunCase[] = [
  {
    key: "check-failed",
    id: "r-1014",
    workflowId: "wf-followups",
    workflowName: "Follow-up tasks from orders",
    status: "failed",
    version: 5,
    latestVersion: 5,
    spec: FOLLOWUPS_SPEC,
    startedAt: minutesAgo(97),
    startedBy: "trigger",
    subject: "Order 5521 confirmed",
    from: "orders@acme.com",
    reviews: [],
    steps: [
      {
        id: "is-order",
        type: "classify",
        does: "Decide whether it's an order confirmation",
        status: "succeeded",
        attempts: 1,
        role: "classify",
        model: CLASSIFIER,
        cost: 1,
        ms: 380,
        output: 'Said "order", 96% sure',
        checks: [{ kind: "confidence", passed: true, says: "96% sure, at least 80% needed" }],
      },
      {
        id: "route",
        type: "branch",
        does: "Pick a path",
        status: "succeeded",
        attempts: 1,
        cost: 0,
        ms: 2,
        paths: [
          { id: "order", name: "Order", taken: true, why: 'is-order said "order", 96% sure' },
          { id: "not-an-order", name: "Otherwise", taken: false, why: "Not needed" },
        ],
      },
      {
        id: "extract-order",
        type: "extract",
        does: "Pull out the order number, customer and ship date",
        path: "Order",
        status: "check_failed",
        attempts: 1,
        role: "fast",
        model: HAIKU,
        cost: 4,
        ms: 1720,
        output: "customer: Acme Corp, due_date: Oct 30, order_number: (empty)",
        checks: [
          { kind: "schema", passed: false, says: "order_number is missing" },
          { kind: "required_fields", passed: false, says: "order_number is empty" },
        ],
        error: {
          code: "check_failed_schema",
          message: "The model's answer didn't fit the schema (missing order_number).",
          todo: "Tell the step where the order number is, or drop it from the checks, then publish a new version and resume the workflow.",
        },
      },
      notReached("add-followup", "tool", "Add a row to the follow-up sheet", "Order"),
    ],
  },
  {
    key: "access-refused",
    id: "r-0991",
    workflowId: "wf-quotes",
    workflowName: "Reply to quote requests",
    status: "failed",
    version: 7,
    latestVersion: 7,
    spec: QUOTES_SPEC,
    startedAt: minutesAgo(52),
    startedBy: "trigger",
    subject: "Quote for 400 kraft mailers?",
    from: "buyer@acme.com",
    reviews: [],
    steps: quoteSteps([
      {
        ...LOOKUP_OK,
        status: "failed",
        output: undefined,
        error: {
          code: "source_forbidden",
          message: "Google refused access to the price sheet.",
          todo: "Reconnect Google, or ask the sheet's owner to share it with this inbox. Then retry.",
        },
      },
      notReached("reply", "draft", "Write the reply as a Gmail draft", "Quote request"),
      APPROVAL_NOT_REACHED,
    ]),
  },
  {
    key: "internal-error",
    id: "r-0987",
    workflowId: "wf-quotes",
    workflowName: "Reply to quote requests",
    status: "failed",
    version: 7,
    latestVersion: 7,
    spec: QUOTES_SPEC,
    startedAt: minutesAgo(61),
    startedBy: "agent",
    subject: "Re: pallet pricing",
    from: "jo@harborgoods.com",
    reviews: [],
    error: {
      code: "internal_error",
      message: "Something went wrong inside Mycel and the run stopped.",
      todo: "This one's ours to fix: there's nothing to change in the workflow. We log every internal error; retry later and it should go through.",
      ours: true,
    },
    steps: quoteSteps([
      LOOKUP_OK,
      {
        ...REPLY_OK,
        status: "failed",
        attempts: 4,
        cost: 0,
        ms: 0,
        output: undefined,
        error: {
          code: "internal_error",
          message: "Internal error.",
          todo: "Ours to fix. Nothing to change here.",
          ours: true,
        },
      },
      APPROVAL_NOT_REACHED,
    ]),
  },
  {
    key: "succeeded",
    id: "r-1005",
    workflowId: "wf-quotes",
    workflowName: "Reply to quote requests",
    status: "succeeded",
    version: 6,
    latestVersion: 7,
    spec: QUOTES_SPEC,
    startedAt: minutesAgo(188),
    startedBy: "retry",
    subject: "Quote for 400 kraft mailers?",
    from: "buyer@acme.com",
    reviews: [{ id: "rv-311", title: "Reply to buyer@acme.com", state: "Waiting in Reviews" }],
    steps: quoteSteps([
      LOOKUP_OK,
      REPLY_OK,
      {
        ...APPROVAL_NOT_REACHED,
        status: "waiting",
        attempts: 1,
        ms: 12,
        output: "Review rv-311 waits in Reviews",
      },
    ]),
  },
];

export const RUN_CASE_KEYS = RUN_CASES.map((c) => c.key);
