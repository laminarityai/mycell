"use client";

// PROTOTYPE, throwaway: the status area's state with stubbed mutations. The pause is worked out
// as M7 says: out of credits first, then failing, then budget reached; saving or removing a budget
// and resuming change local state only.
import { useState } from "react";
import { startFor } from "./fixtures";

export type Effective = "running" | "out_of_credits" | "failures" | "budget_reached";

export function useWorkflowStatus(state: string) {
  const start = startFor(state);
  const [budget, setBudget] = useState(start.budget);
  const [pausedForFailures, setPausedForFailures] = useState(start.pausedForFailures);
  const [notice, setNotice] = useState<string | null>(null);
  const { spent, balance } = start;
  const reached = budget !== null && spent >= budget;
  const effective: Effective =
    balance <= 0
      ? "out_of_credits"
      : pausedForFailures
        ? "failures"
        : reached
          ? "budget_reached"
          : "running";
  return {
    spent,
    budget,
    balance,
    effective,
    pausedForFailures,
    /** Also true when another pause shows first, so the page can say both. */
    reached,
    notice,
    saveBudget(next: number | null) {
      setBudget(next);
      const nowReached = next !== null && spent >= next;
      const otherPause = balance <= 0 || pausedForFailures;
      setNotice(
        next === null
          ? "Budget removed. Only the company's balance limits this workflow now."
          : nowReached
            ? "Budget saved. It's already spent this month, so the workflow is paused."
            : reached && !otherPause
              ? "Budget saved. The workflow resumed at once."
              : "Budget saved.",
      );
    },
    resume() {
      setPausedForFailures(false);
      setNotice("Resumed. Its count of failed runs starts again from zero.");
    },
  };
}

export type WorkflowStatus = ReturnType<typeof useWorkflowStatus>;

export const PAUSE_LABEL: Record<Exclude<Effective, "running">, string> = {
  out_of_credits: "Paused: out of credits",
  failures: "Paused: failing",
  budget_reached: "Paused: budget reached",
};
