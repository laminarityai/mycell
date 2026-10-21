"use client";

// What a `propose_spec` call shows the admin: the proposal card once one was stored, nothing
// much while the agent repairs a spec, and every issue once it gave up for the turn.
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { publishWorkflowAction } from "@/features/workflows/actions";
import type { Proposal, ProposeSpecResult } from "../types";
import { ProposalCard } from "./proposal-card";

export function ProposeSpecPart({
  output,
  proposals,
}: {
  output: ProposeSpecResult | undefined;
  proposals: Map<string, Proposal>;
}) {
  if (output === undefined) {
    return <p className="text-xs text-muted-foreground">Checking a proposal…</p>;
  }
  if (output.ok) {
    const proposal = proposals.get(output.proposalId);
    if (proposal === undefined) {
      return <p className="text-xs text-muted-foreground">Preparing the proposal…</p>;
    }
    return <ProposalCard proposal={proposal} />;
  }
  if (!output.gaveUp) {
    const count = output.issues.length;
    return (
      <p className="text-xs text-muted-foreground">
        Checked a proposal and found {count} {count === 1 ? "issue" : "issues"} to fix.
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
      <p>The builder couldn&apos;t make a proposal that passes validation:</p>
      <ul className="list-disc pl-5">
        {output.issues.map((issue) => (
          <li key={`${issue.path.join(".")}:${issue.message}`}>
            {issue.path.length > 0 ? (
              <code className="mr-1 font-mono">{issue.path.join(".")}</code>
            ) : null}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The conversation's workflow, with Publish (M3's) once its working spec isn't published. */
export type ConversationWorkflow = { id: string; name: string; unpublishedChanges: boolean };

export function PublishBar({ workflow }: { workflow: ConversationWorkflow }) {
  const [result, publish, publishing] = useActionState(publishWorkflowAction, {});
  if (!workflow.unpublishedChanges) return null;
  return (
    <form
      action={publish}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
    >
      <input type="hidden" name="workflowId" value={workflow.id} />
      <span>“{workflow.name}” has changes that aren&apos;t published.</span>
      <Button type="submit" variant="outline" disabled={publishing}>
        Publish
      </Button>
      {result.error === undefined ? null : (
        <p role="alert" className="w-full text-destructive">
          {result.error}
        </p>
      )}
    </form>
  );
}
