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
import { blankSpec } from "./lib/blank-spec";
import { GraphTraceProvider, useGraphTrace, useShowOnGraph } from "./lib/graph-trace";
import { RiskBadge } from "./lib/risk-badge";
import { SpecEditor } from "./lib/spec-editor";
import { SwitchForm, type SwitchConnectionOption } from "./lib/switch-form";
import { PublishButton } from "./lib/workflow-editor";
import { WorkflowGraph, type WorkflowGraphProps } from "./lib/workflow-graph";
import type { WorkflowDetails, WorkflowSummary, WorkflowSwitch } from "./types";

export {
  GraphTraceProvider,
  RiskBadge,
  useGraphTrace,
  useShowOnGraph,
  WorkflowGraph,
  type WorkflowGraphProps,
};

/** A new workflow's editor, starting from a spec with no steps. */
export function NewWorkflowEditor() {
  return <SpecEditor spec={blankSpec()} maxRisk={null} />;
}

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

/** The admin's workflows: name, latest version, its max risk level, and whether it's on. */
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
          <TableHead>Switch</TableHead>
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
            <TableCell>
              <SwitchBadge current={workflow.switch} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Whether the workflow is on: for the admin's own connection, for the org's, or off. */
function SwitchBadge({ current }: { current: WorkflowSwitch | null }) {
  if (current === null) return <Badge variant="secondary">Off</Badge>;
  return (
    <Badge variant="outline">
      {current.kind === "member" ? "On for your connection" : "On for the org"}
    </Badge>
  );
}

/**
 * One workflow: its working spec in the editor (a graph or JSON, validated live), then Publish
 * and its versions. The editor starts again from each save's revision.
 */
export function WorkflowEditor({ workflow }: { workflow: WorkflowDetails }) {
  const latest = workflow.versions.at(0);
  return (
    <div className="flex flex-col gap-6">
      <SpecEditor
        key={workflow.revision}
        workflowId={workflow.id}
        name={workflow.name}
        spec={workflow.workingSpec}
        revision={workflow.revision}
        maxRisk={workflow.maxRisk}
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
