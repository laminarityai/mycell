"use client";

// A proposal in the conversation: what it changes, grouped by path, in plain words: each path's
// condition, each step's catalog risk level, the steps that wait for a review (those the policy
// engine added can't be removed), and Accept and Reject while it waits for a decision.
import Link from "next/link";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/features/workflows/ui";
import type { Change } from "@/features/spec/diff";
import type { ActionResult } from "@/lib/errors";
import { acceptProposalAction, rejectProposalAction } from "../actions";
import type { Proposal, ProposalGroup, ProposalPath, ProposalStatus, ProposalStep } from "../types";

const STATUS_LABELS: Record<ProposalStatus, string> = {
  proposed: "Waiting for your decision",
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Out of date",
};

const CHANGE_LABELS: Record<Change, string | null> = {
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
      <div className="flex flex-col gap-3">
        {proposal.groups.map((group) => (
          <GroupSection key={group.path?.id ?? "start"} group={group} />
        ))}
      </div>
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

/** The changes on one path, under its name and condition; the steps before any branch first. */
function GroupSection({ group }: { group: ProposalGroup }) {
  const { path, steps } = group;
  const title = path === null ? null : [...path.within, path.name].join(" › ");
  return (
    <section
      aria-label={title === null ? "Before any branch" : `Path ${title}`}
      className={path === null ? "flex flex-col gap-2" : "flex flex-col gap-2 border-l-2 pl-3"}
    >
      {path === null || title === null ? null : <PathHeader path={path} title={title} />}
      {steps.length === 0 ? null : (
        <ol
          className="flex flex-col gap-2"
          aria-label={title === null ? "Steps" : `Steps on ${title}`}
        >
          {steps.map((step) => (
            <StepRow key={`${step.change}:${step.id}`} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PathHeader({ path, title }: { path: ProposalPath; title: string }) {
  const change = CHANGE_LABELS[path.change];
  return (
    <div
      className={
        path.change === "removed"
          ? "flex flex-col gap-1 text-sm text-muted-foreground line-through"
          : "flex flex-col gap-1 text-sm"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {change === null ? null : <Badge variant="outline">{change}</Badge>}
        <span className="font-medium">{path.otherwise ? title : `Path “${title}”`}</span>
      </div>
      <p>{path.text}</p>
      {path.before === null ? null : (
        <p className="text-xs text-muted-foreground">
          Before: “{path.before.name}”. {path.before.text}
        </p>
      )}
    </div>
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
