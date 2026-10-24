// The Workflows page as a member sees it: each workflow published to one of their tags, what it
// does and the apps it uses, whether it's on, and the switch for one that runs on their own
// account.
import { AppMarks } from "@/components/app-mark";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReconnectButton } from "@/features/connections/ui";
import type { VisibleWorkflow, WorkflowSwitch } from "../types";
import { EnableSwitch } from "./enable-switch";
import { PausedNotice, StateBadge } from "./pause-display";
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
        <CardDescription>{runsOn(workflow)}</CardDescription>
        <CardAction>
          <AppMarks apps={workflow.requiredApps} sharedInbox={workflow.sharedInbox} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Risk level</dt>
          <dd>
            <RiskBadge risk={workflow.maxRisk} />
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <StateBadge current={workflow.switch} />
          </dd>
        </dl>
        <PausedNotice current={workflow.switch} />
        {workflow.credentials === "member" ? (
          <EnableSwitch workflowId={workflow.id} name={workflow.name} current={workflow.switch} />
        ) : null}
        <ReconnectNotice current={workflow.switch} />
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

function runsOn(workflow: VisibleWorkflow): string {
  if (workflow.credentials === "member") return "Runs on your own Google account.";
  return workflow.sharedInbox === null
    ? "Runs on a shared inbox, managed by admins."
    : `Runs on the shared inbox ${workflow.sharedInbox}, managed by admins.`;
}

// Google stopped accepting the member's connection: their switch is kept, but nothing runs on
// it until they reconnect.
function ReconnectNotice({ current }: { current: WorkflowSwitch | null }) {
  if (current?.kind !== "member" || !current.needsReconnect) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <p>Google stopped accepting your connection. Reconnect Google to keep this running.</p>
      <ReconnectButton
        connectionId={current.connectionId}
        accountEmail="your Google account"
        label="Reconnect Google"
      />
    </div>
  );
}
