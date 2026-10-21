// The Workflows page as a member sees it: each workflow published to one of their tags, what it
// does and needs, and whether it's on. Read-only until members switch workflows on (#53).
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VisibleWorkflow, WorkflowSwitch } from "../types";
import { RiskBadge } from "./risk-badge";

export function VisibleWorkflowsList({ workflows }: { workflows: VisibleWorkflow[] }) {
  if (workflows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflows are published to your tags yet. Ask an admin which tags you need.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4" aria-label="Workflows">
      {workflows.map((workflow) => (
        <li key={workflow.id}>
          <VisibleWorkflowCard workflow={workflow} />
        </li>
      ))}
    </ul>
  );
}

function VisibleWorkflowCard({ workflow }: { workflow: VisibleWorkflow }) {
  return (
    <Card aria-label={workflow.name}>
      <CardHeader>
        <CardTitle>{workflow.name}</CardTitle>
        <CardDescription>
          {workflow.credentials === "org"
            ? "Runs on a shared inbox, managed by admins."
            : "Runs on your own Google account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Needs</dt>
          <dd>{workflow.requiredApps.join(", ")}</dd>
          <dt className="text-muted-foreground">Risk level</dt>
          <dd>
            <RiskBadge risk={workflow.maxRisk} />
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StateBadge current={workflow.switch} />
          </dd>
        </dl>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {workflow.description.map((sentence, index) => (
            // Sentences may repeat (two similar steps), so the position keys them.
            <li key={index}>{sentence}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Whether the workflow is on for the member: their own enablement, the org switch, or off. */
function StateBadge({ current }: { current: WorkflowSwitch | null }) {
  if (current === null) return <Badge variant="secondary">Off</Badge>;
  return (
    <Badge variant="outline">
      {current.kind === "member" ? "On for your connection" : "On for the shared inbox"}
    </Badge>
  );
}
