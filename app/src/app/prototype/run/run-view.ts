// PROTOTYPE, throwaway: what one viewer is given of a run, as `getRun(ctx, runId)` would decide
// it: whose inbox it ran on, whether it's shown in full or redacted, whether Retry is allowed and
// why not, and the trace the workflow graph lights up.
import type { GraphTrace } from "@/features/spec/graph";
import { PAUSED_TEXT, PEOPLE, viewerFor, workflowById, type Person } from "../_shared/fixtures";
import { RUN_CASES, type RunCase, type RunStep } from "./run-cases";

export type RunView = {
  run: RunCase;
  viewer: Person;
  /** The inbox's owner. */
  owner: Person;
  /** "your inbox" or "Tom Becker's inbox". */
  inbox: string;
  /** Subject, sender, outputs and the Gmail link are shown. */
  full: boolean;
  /** A member asking for a colleague's run: they're told it isn't theirs. */
  hidden: boolean;
  /** `hide`: not the connection's reader, so there is no Retry at all, just why. */
  retry: { allowed: true } | { allowed: false; why: string; hide?: boolean };
  gmailHref: string;
  versionHref: string;
  trace: GraphTrace;
};

export const VIEW_TOGGLE = { param: "view", options: ["full", "redacted"] };
export const RUN_TOGGLE = {
  param: "run",
  options: ["check-failed", "access-refused", "internal-error", "succeeded"],
};

export function runView(params: Record<string, string>): RunView {
  const run = RUN_CASES.find((c) => c.key === params.run) ?? RUN_CASES[0];
  const viewer = viewerFor(params.as);
  const colleague = params.view === "redacted";
  const owner = colleague ? PEOPLE.tom : viewer;
  const full = !colleague;
  const inbox = colleague ? `${owner.name}'s inbox` : "your inbox";
  return {
    run,
    viewer,
    owner,
    inbox,
    full,
    hidden: colleague && viewer.role === "member",
    retry: retryOf(run, full, owner),
    gmailHref: "https://mail.google.com/mail/u/0/#all/1929a3f0c4e1b2d7",
    versionHref: `/prototype/workflow-status?version=${String(run.version)}`,
    trace: traceOf(run.steps, full),
  };
}

function retryOf(run: RunCase, full: boolean, owner: Person): RunView["retry"] {
  if (!full) {
    return {
      allowed: false,
      why: `Only ${owner.name} can retry a run on their own inbox.`,
      hide: true,
    };
  }
  if (run.status !== "failed" && run.status !== "partly_failed") {
    return { allowed: false, why: "Only a failed run can be retried. This one succeeded." };
  }
  const paused = workflowById(run.workflowId)?.paused ?? null;
  if (paused !== null) {
    return {
      allowed: false,
      why: `${run.workflowName} is paused (${PAUSED_TEXT[paused]}). Resume it first, then retry.`,
    };
  }
  return { allowed: true };
}

/** The graph's trace: the steps the run reached, and each path with why; the why is output. */
function traceOf(steps: RunStep[], full: boolean): GraphTrace {
  return {
    steps: steps
      .filter((s) => s.status !== "not_reached")
      .map((s) => ({
        stepId: s.id,
        status: s.status === "waiting" ? "succeeded" : s.status,
        paths: s.paths?.map((p) => ({
          id: p.id,
          status: p.taken ? ("taken" as const) : ("not_needed" as const),
          checks: p.taken ? [{ check: p.name, passed: true, reason: full ? p.why : "Held" }] : [],
        })),
      })),
  };
}

export const STEP_STATUS_WORDS: Record<RunStep["status"], string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  check_failed: "Check failed",
  not_reached: "Didn't run",
  waiting: "Waiting for review",
};

export const isStepFailure = (s: RunStep) => s.status === "failed" || s.status === "check_failed";

/** The step the run stopped at, if it stopped at one. */
export const failedStep = (run: RunCase) => run.steps.find(isStepFailure);

export const totalCost = (run: RunCase) => run.steps.reduce((sum, s) => sum + s.cost, 0);

export const totalSeconds = (run: RunCase) =>
  (run.steps.reduce((sum, s) => sum + s.ms, 0) / 1000).toFixed(1);
