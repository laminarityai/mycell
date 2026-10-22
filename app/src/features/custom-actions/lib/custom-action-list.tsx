// The custom actions page's list (ADR-0018): each custom action the company's admins accepted, in
// plain words, who accepted it and when, and the workflows that use it.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserNames } from "@/features/orgs/types";
import type { ActionUse } from "@/features/workflows/types";
import { RiskBadge } from "@/features/workflows/ui";
import { customActionWords } from "../description";
import type { StoredCustomAction } from "../types";

export function CustomActionList({
  actions,
  uses,
  nameOf,
}: {
  actions: StoredCustomAction[];
  /** The workflows using each action, by its name (`workflowsUsingActions`). */
  uses: ReadonlyMap<string, ActionUse[]>;
  nameOf: UserNames;
}) {
  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No custom actions yet. When no catalog action fits what you describe, the builder chat
        proposes one, and accepting the proposal adds it here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4" aria-label="Custom actions">
      {actions.map((action) => (
        <li key={action.id}>
          <ActionCard
            action={action}
            uses={uses.get(action.name) ?? []}
            acceptedBy={nameOf(action.acceptedBy)}
          />
        </li>
      ))}
    </ul>
  );
}

function ActionCard({
  action,
  uses,
  acceptedBy,
}: {
  action: StoredCustomAction;
  uses: ActionUse[];
  acceptedBy: string;
}) {
  const words = customActionWords(action);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{words.app}</span>
          <RiskBadge risk={words.risk} />
        </CardTitle>
        <CardDescription className="font-mono text-xs break-all">{words.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{words.description}</p>
        <p className="text-xs text-muted-foreground">
          Calls <code className="font-mono break-all">{words.call}</code>. Its level was set by
          rule.
        </p>
        <p className="text-muted-foreground">
          Accepted by {acceptedBy} on{" "}
          {action.acceptedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </p>
        <WorkflowUses uses={uses} />
      </CardContent>
    </Card>
  );
}

function WorkflowUses({ uses }: { uses: ActionUse[] }) {
  if (uses.length === 0) {
    return <p className="text-muted-foreground">No workflow uses it.</p>;
  }
  return (
    <div>
      <p className="font-medium">Used by</p>
      <ul className="list-inside list-disc" aria-label="Workflows using it">
        {uses.map((use) => (
          <li key={use.workflowId}>
            <Link href={`/workflows/${use.workflowId}`} className="underline">
              {use.name}
            </Link>{" "}
            <span className="text-muted-foreground">{whereUsed(use)}</span>
            {use.archived ? (
              <Badge variant="outline" className="ml-2">
                Archived
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where the workflow uses it: its latest version, its working spec, or both. */
function whereUsed(use: ActionUse): string {
  if (use.publishedVersion === null) return "in the working spec, not yet published";
  const version = `version ${String(use.publishedVersion)}`;
  return use.inWorkingSpec
    ? `in ${version} and the working spec`
    : `in ${version}, not the working spec`;
}
