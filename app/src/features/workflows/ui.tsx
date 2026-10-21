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
import type { Tag } from "@/features/tags/types";
import { PublishDialog } from "./lib/workflow-editor";
import { WorkflowGraph, type WorkflowGraphProps } from "./lib/workflow-graph";
import { WorkingSpecEditor, type EditableWorkflow } from "./lib/working-spec-editor";
import { pausedReasonText } from "./lib/visible-workflows";
import type {
  Audience,
  EnablementSummary,
  WorkflowDetails,
  WorkflowSummary,
  WorkflowSwitch,
} from "./types";

export { VisibleWorkflowsList } from "./lib/visible-workflows";

export {
  GraphTraceProvider,
  RiskBadge,
  useGraphTrace,
  useShowOnGraph,
  WorkflowGraph,
  WorkingSpecEditor,
  type EditableWorkflow,
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

/**
 * The admin's workflows: name, latest version, its max risk level, the tags it's published to
 * and how many users they reach, whether it's on for them or the org, and who has it on or
 * paused (`enablements`, by workflow ID).
 */
export function WorkflowsList({
  workflows,
  enablements,
}: {
  workflows: WorkflowSummary[];
  enablements: ReadonlyMap<string, EnablementSummary[]>;
}) {
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
          <TableHead>Published to</TableHead>
          <TableHead>Reach</TableHead>
          <TableHead>Switch</TableHead>
          <TableHead>Enabled by</TableHead>
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
              <AudienceTags audience={workflow.audience} />
            </TableCell>
            <TableCell>{reach(workflow.audience)}</TableCell>
            <TableCell>
              <SwitchBadge current={workflow.switch} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <EnabledBy enablements={enablements.get(workflow.id) ?? []} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The tags a published workflow is published to, or a dash. */
function AudienceTags({ audience }: { audience: Audience | null }) {
  if (audience === null) return "—";
  if (audience.tags.length === 0) return <span className="text-muted-foreground">No tags</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {audience.tags.map((tag) => (
        <Badge key={tag.id} variant="outline">
          {tag.name}
        </Badge>
      ))}
    </span>
  );
}

function reach(audience: Audience | null): string {
  if (audience === null) return "—";
  return audience.reach === 1 ? "1 user" : `${String(audience.reach)} users`;
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

/** Who has the workflow switched on, each marked when paused. */
function EnabledBy({ enablements }: { enablements: EnablementSummary[] }) {
  if (enablements.length === 0) return <span className="text-muted-foreground">Nobody</span>;
  return (
    <ul className="flex flex-col gap-1">
      {enablements.map((enablement) => (
        <li key={enablement.userId}>
          {enablement.name}
          {enablement.status === "paused"
            ? ` (paused: ${pausedReasonText(enablement.pausedReason)})`
            : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One workflow: its working spec in the editor (a graph or JSON, validated live), then Publish
 * (to the org's `tags`) and its versions. The editor starts again from each save's revision.
 */
export function WorkflowEditor({ workflow, tags }: { workflow: WorkflowDetails; tags: Tag[] }) {
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
        <PublishDialog
          // A publish or a save starts the dialog again from the working spec's tags.
          key={workflow.revision}
          workflowId={workflow.id}
          nextNumber={(latest?.number ?? 0) + 1}
          tags={tags}
          chosen={workflow.workingSpec.visibility?.tags ?? []}
        />
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
