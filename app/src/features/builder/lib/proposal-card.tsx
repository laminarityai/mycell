"use client";

// A proposal in the conversation: the before/after of the workflow's steps in plain words, each
// step's catalog risk level, the steps that wait for a review (those the policy engine added
// can't be removed), and Accept and Reject while it waits for a decision.
import Link from "next/link";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/features/workflows/ui";
import type { StepChange } from "@/features/spec/diff";
import type { ActionResult } from "@/lib/errors";
import { acceptProposalAction, rejectProposalAction } from "../actions";
import type { Proposal, ProposalStatus, ProposalStep } from "../types";

const STATUS_LABELS: Record<ProposalStatus, string> = {
  proposed: "Waiting for your decision",
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Out of date",
};

const CHANGE_LABELS: Record<StepChange, string | null> = {
  added: "New",
  removed: "Removed",
  changed: "Changed",
  unchanged: null,
};

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [accepted, accept, accepting] = useActionState(acceptProposalAction, {});
  const [rejected, reject, rejecting] = useActionState(rejectProposalAction, {});
  const busy = accepting || rejecting;
  return (
    <article
      aria-label={`Proposal: ${proposal.name}`}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {proposal.workflowId === null ? "New workflow" : "Change to"} “{proposal.name}”
        </h3>
        <Badge variant={proposal.status === "proposed" ? "default" : "secondary"}>
          {STATUS_LABELS[proposal.status]}
        </Badge>
      </header>
      <p>{proposal.summary}</p>
      {proposal.settings.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          Also changes: {proposal.settings.join(", ")}
        </p>
      )}
      <ol className="flex flex-col gap-2" aria-label="Steps">
        {proposal.steps.map((step) => (
          <StepRow key={`${step.change}:${step.id}`} step={step} />
        ))}
      </ol>
      {proposal.status === "stale" ? (
        <p className="text-sm text-muted-foreground">
          The workflow changed after this was proposed, so it wasn&apos;t saved. Ask the builder to
          propose it again from the current working spec.
        </p>
      ) : null}
      {proposal.status === "accepted" && proposal.workflowId !== null ? (
        <Link href={`/workflows/${proposal.workflowId}`} className="text-sm underline">
          Open the workflow
        </Link>
      ) : null}
      {proposal.status !== "proposed" ? null : (
        <div className="flex gap-2">
          <form action={accept}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <Button type="submit" disabled={busy}>
              Accept
            </Button>
          </form>
          <form action={reject}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <Button type="submit" variant="outline" disabled={busy}>
              Reject
            </Button>
          </form>
        </div>
      )}
      <Problem result={accepted} />
      <Problem result={rejected} />
    </article>
  );
}

function StepRow({ step }: { step: ProposalStep }) {
  const change = CHANGE_LABELS[step.change];
  return (
    <li
      className={
        step.change === "removed"
          ? "flex flex-col gap-1 text-sm text-muted-foreground line-through"
          : "flex flex-col gap-1 text-sm"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {change === null ? null : <Badge variant="outline">{change}</Badge>}
        <span>{step.text}</span>
        {step.risk === null ? null : <RiskBadge risk={step.risk} />}
        {step.waitsForReview ? (
          <Badge variant="secondary">
            {step.requiredByPolicy ? "Waits for review (required by policy)" : "Waits for review"}
          </Badge>
        ) : null}
      </div>
      {step.before === null ? null : (
        <p className="text-xs text-muted-foreground">Before: {step.before}</p>
      )}
    </li>
  );
}

function Problem({ result }: { result: ActionResult }) {
  if (result.error === undefined) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {result.error}
    </p>
  );
}
