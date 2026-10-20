import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RiskLevel } from "@/features/policy/types";
import { SwitchForm, type SwitchConnectionOption } from "./lib/switch-form";
import { PublishButton, WorkflowForm } from "./lib/workflow-editor";
import type { WorkflowDetails, WorkflowSummary } from "./types";

export { WorkflowForm };

/**
 * The workflow's switch. A member workflow is switched on for the admin's own connection, an
 * org workflow for one org connection: `connections` are the ones its credentials allow.
 */
export function WorkflowSwitchSection({
  workflow,
  connections,
}: {
  workflow: WorkflowDetails;
  connections: SwitchConnectionOption[];
}) {
  return (
    <section className="flex flex-col gap-2" aria-label="Switch">
      <h2 className="text-lg font-semibold">Switch</h2>
      <SwitchForm
        workflowId={workflow.id}
        current={workflow.switch}
        connections={connections}
        published={workflow.versions.length > 0}
      />
    </section>
  );
}

const RISK_LABELS: Record<RiskLevel, string> = {
  read: "Read",
  internal_reversible: "Internal, reversible",
  external_send: "External send",
  financial: "Financial",
  destructive: "Destructive",
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge variant={risk === "read" ? "secondary" : "outline"}>{RISK_LABELS[risk]}</Badge>;
}

/** The admin's workflows: name, latest version and its max risk level. */
export function WorkflowsList({ workflows }: { workflows: WorkflowSummary[] }) {
  if (workflows.length === 0) {
    return <p className="text-sm text-muted-foreground">No workflows yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workflow</TableHead>
          <TableHead>Latest version</TableHead>
          <TableHead>Max risk</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workflows.map((workflow) => (
          <TableRow key={workflow.id}>
            <TableCell>
              <Link
                href={`/workflows/${workflow.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {workflow.name}
              </Link>
            </TableCell>
            <TableCell>
              {workflow.latestVersion === null
                ? "Not published"
                : `Version ${String(workflow.latestVersion.number)}`}
            </TableCell>
            <TableCell>
              {workflow.latestVersion === null ? (
                "—"
              ) : (
                <RiskBadge risk={workflow.latestVersion.maxRisk} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One workflow: its working spec to edit, what the policy makes of it, Publish, and versions. */
export function WorkflowEditor({ workflow }: { workflow: WorkflowDetails }) {
  const latest = workflow.versions.at(0);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 text-sm" aria-label="Policy">
        <p className="flex items-center gap-2">
          Max risk of the working spec:{" "}
          {workflow.maxRisk === null ? "unknown" : <RiskBadge risk={workflow.maxRisk} />}
        </p>
        {workflow.inserted.length === 0 ? null : (
          <ul className="list-disc pl-5">
            {workflow.inserted.map((approval) => (
              <li key={approval.stepId}>
                Inserted approval <code className="font-mono">{approval.stepId}</code> after{" "}
                <code className="font-mono">{approval.after}</code>, because{" "}
                <code className="font-mono">{approval.action}</code> sends outside the company.
              </li>
            ))}
          </ul>
        )}
      </section>
      <WorkflowForm
        key={workflow.updatedAt.toISOString()}
        workflowId={workflow.id}
        name={workflow.name}
        spec={JSON.stringify(workflow.workingSpec, null, 2)}
      />
      <section className="flex flex-col gap-2" aria-label="Versions">
        <h2 className="text-lg font-semibold">Versions</h2>
        <p className="text-sm text-muted-foreground">
          {latest === undefined
            ? "Not published yet."
            : `Version ${String(latest.number)} is the latest. Publishing makes the saved spec version ${String(latest.number + 1)}.`}
        </p>
        <PublishButton workflowId={workflow.id} />
        {workflow.versions.length === 0 ? null : (
          <ul className="flex flex-col gap-1 text-sm">
            {workflow.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-2">
                Version {version.number}, published {version.publishedAt.toLocaleString("en-US")}
                <RiskBadge risk={version.maxRisk} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
