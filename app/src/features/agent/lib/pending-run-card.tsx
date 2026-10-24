"use client";

// A run the agent offered, in the conversation: the workflow and the message it would run on
// (sender, subject and date, read from Gmail as the page loads), and Run, which only the person
// presses. Once it started, how the run is going, with links to its runs and to Reviews.
import { Play } from "lucide-react";
import Link from "next/link";
import { createContext, use, useActionState, useMemo, type ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import type { RunStatus } from "@/features/runtime/types";
import { runsHref } from "@/features/runtime/ui";
import { runPendingRunAction } from "../actions";
import type { PendingRun, ProposeRunResult } from "../types";

const OUTCOMES: Record<RunStatus, string> = {
  running: "Running. Refresh the page to see how it ends.",
  succeeded: "Finished. Anything it drafted waits for you on Reviews.",
  skipped: "Finished: the workflow decided this message needed nothing.",
  escalated: "Finished: it handed the message to a person, on Reviews.",
  cancelled:
    "Stopped before it finished: the workflow was switched off, or your inbox disconnected.",
  failed: "It failed. The Runs page says at which step.",
  partly_failed: "Part of it failed. The Runs page says at which step.",
};

// The conversation's pending runs by ID, as the server last read them.
const PendingRuns = createContext<ReadonlyMap<string, PendingRun>>(new Map());

/** Gives the replies inside it the conversation's pending runs, derived as the page renders. */
export function PendingRunsProvider({
  pendingRuns,
  children,
}: {
  pendingRuns: PendingRun[];
  children: ReactNode;
}) {
  const byId = useMemo(() => new Map(pendingRuns.map((p) => [p.id, p])), [pendingRuns]);
  return <PendingRuns value={byId}>{children}</PendingRuns>;
}

/**
 * What a `propose_run` call shows: the pending run's card once the page has read it (a turn's
 * end reads the conversation again), or why the agent offered nothing.
 */
export function ProposeRunPart({ output }: { output: ProposeRunResult | undefined }) {
  const pendingRuns = use(PendingRuns);
  if (output === undefined) {
    return <p className="text-xs text-muted-foreground">Checking the workflow and message…</p>;
  }
  if (!output.proposed) {
    return <p className="text-sm text-muted-foreground">Didn&apos;t offer a run: {output.why}</p>;
  }
  const pending = pendingRuns.get(output.pendingRunId);
  if (pending === undefined) {
    return <p className="text-xs text-muted-foreground">Preparing the run…</p>;
  }
  return <PendingRunCard pending={pending} />;
}

function PendingRunCard({ pending }: { pending: PendingRun }) {
  const [result, run, running] = useActionState(runPendingRunAction, {});
  const { message } = pending;
  return (
    <article
      aria-label={`Run ${pending.workflowName}`}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <h3 className="font-medium">Run “{pending.workflowName}” on this message?</h3>
      {message === null ? (
        <p className="text-sm text-muted-foreground">This message is no longer in your mail.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">From</dt>
          <dd className="truncate">{message.from || "(no sender)"}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="truncate">{message.subject || "(no subject)"}</dd>
          <dt className="text-muted-foreground">Received</dt>
          <dd>
            <DateTime value={message.receivedAt} />
          </dd>
        </dl>
      )}
      {pending.run === null ? (
        <form action={run} className="flex flex-col gap-2">
          <input type="hidden" name="pendingRunId" value={pending.id} />
          <p className="text-xs text-muted-foreground">
            Nothing runs until you press Run. What it drafts waits for your approval on Reviews.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={running || message === null}>
              <Play aria-hidden />
              {running ? "Starting…" : "Run"}
            </Button>
          </div>
          <FormError message={result.error} />
        </form>
      ) : (
        <div className="flex flex-col gap-1 text-sm" role="status">
          <p>{OUTCOMES[pending.run.status]}</p>
          <p className="flex gap-3 text-xs">
            <Link className="underline" href={runsHref({ workflowId: pending.workflowId })}>
              See its runs
            </Link>
            <Link className="underline" href="/reviews">
              Open Reviews
            </Link>
          </p>
        </div>
      )}
    </article>
  );
}
