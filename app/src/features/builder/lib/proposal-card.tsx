"use client";

// A proposal in the conversation: what it changes, grouped by path, in plain words: each path's
// condition, each step's catalog risk level, the steps that wait for a review (those the policy
// engine added can't be removed), and, while it waits for a decision, Accept and Reject and
// showing or hiding it on the page's graph.
import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/features/workflows/ui";
import type { Change } from "@/features/spec/diff";
import { cn } from "@/lib/utils";
import { acceptProposalAction, rejectProposalAction } from "../actions";
import type {
  Proposal,
  ProposalGroup,
  ProposalPath,
  ProposalStatus,
  ProposalStep,
  ProposedCustomAction,
} from "../types";
import { useProposalOnGraph } from "./proposal-on-graph";

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
      {proposal.customActions.length === 0 ? null : (
        <ul className="flex flex-col gap-2" aria-label="New custom actions">
          {proposal.customActions.map((action) => (
            <CustomActionPart key={action.name} action={action} />
          ))}
        </ul>
      )}
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
      {proposal.status !== "proposed" ? null : <ShowOnGraph proposalId={proposal.id} />}
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
      <FormError message={accepted.error} />
      <FormError message={rejected.error} />
    </article>
  );
}

/**
 * A custom action the proposal brings (ADR-0018), in plain words: its app, what it does, the call
 * it makes, and the level the fixed rule set. Accepting the proposal stores it.
 */
function CustomActionPart({ action }: { action: ProposedCustomAction }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">New custom action</Badge>
        <span className="font-medium">{action.app}</span>
      </div>
      <p>{action.description}</p>
      <p className="text-xs text-muted-foreground">
        Calls <code className="font-mono break-all">{action.call}</code>
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <RiskBadge risk={action.risk} />
        <span className="text-muted-foreground">set by rule</span>
      </p>
    </li>
  );
}

/** Draws the waiting proposal on the page's graph, or puts it away; nothing on a page without. */
function ShowOnGraph({ proposalId }: { proposalId: string }) {
  const graph = useProposalOnGraph();
  if (graph === null) return null;
  const shown = graph.drawn?.id === proposalId;
  return (
    <Button
      type="button"
      variant="link"
      className="self-start px-0 text-foreground underline"
      onClick={() => {
        graph.show(proposalId, !shown);
      }}
    >
      {shown ? "Hide it on the graph" : "Show it on the graph"}
    </Button>
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
  return (
    <ChangeRow change={path.change}>
      <span className="font-medium">{path.otherwise ? title : `Path “${title}”`}</span>
      <p>{path.text}</p>
      {path.before === null ? null : (
        <p className="text-xs text-muted-foreground">
          Before: “{path.before.name}”. {path.before.text}
        </p>
      )}
    </ChangeRow>
  );
}

function StepRow({ step }: { step: ProposalStep }) {
  return (
    <ChangeRow as="li" change={step.change}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0">{step.text}</span>
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
    </ChangeRow>
  );
}

/**
 * A changed step or path: its change's badge beside its first line, and its words in a column
 * of their own, so a long line wraps under itself rather than under the badge.
 */
function ChangeRow({
  as: Row = "div",
  change,
  children,
}: {
  as?: "div" | "li";
  change: Change;
  children: ReactNode;
}) {
  const label = CHANGE_LABELS[change];
  return (
    <Row
      className={cn(
        "grid items-start gap-x-2 text-sm",
        label === null ? "grid-cols-1" : "grid-cols-[auto_minmax(0,1fr)]",
        change === "removed" && "text-muted-foreground line-through",
      )}
    >
      {label === null ? null : <Badge variant="outline">{label}</Badge>}
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </Row>
  );
}
