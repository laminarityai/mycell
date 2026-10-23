"use client";

// The builder conversation as a split screen: the chat on the left, the workflow's graph on the
// right (its working spec, a waiting proposal drawn as its changes, or a Try it's route).
// Under 768px the two become tabs, Chat and Workflow, which turn to Workflow when a proposal or
// a Try it is shown. Both stay mounted, so a turn streams on while the graph is looked at.
import { MessageSquare, Workflow } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import {
  ActionSetProvider,
  GraphTraceProvider,
  useGraphTrace,
  WorkflowGraph,
  WorkingSpecEditor,
  type EditableWorkflow,
} from "@/features/workflows/ui";
import { cn } from "@/lib/utils";
import type { Proposal } from "../types";
import { ProposalOnGraphProvider, useProposalOnGraph } from "./proposal-on-graph";

/** The conversation's workflow: its name, and its working spec at the revision it was read. */
export type WorkspaceWorkflow = EditableWorkflow;

export function BuilderWorkspace({
  proposals,
  workflow,
  customActions,
  chat,
}: {
  proposals: Proposal[];
  /** The company's custom actions, which the graph looks actions up in with the catalog. */
  customActions: CustomActionRecord[];
  /** The conversation's workflow; null until a proposal for a new one is accepted. */
  workflow: WorkspaceWorkflow | null;
  chat: ReactNode;
}) {
  // A Try it is of the working spec at one revision, before the newest proposal so far: a new
  // revision or a new proposal takes the graph over from it.
  const newest = proposals.filter((proposal) => proposal.status === "proposed").at(-1)?.id;
  const [arrived, setArrived] = useState(newest);
  if (newest !== undefined && newest !== arrived) setArrived(newest);
  return (
    <GraphTraceProvider of={`${revisionOf(workflow) ?? ""}/${arrived ?? ""}`}>
      <ProposalOnGraphProvider proposals={proposals}>
        <ActionSetProvider customActions={customActions}>
          <Split workflow={workflow} customActions={customActions} chat={chat} />
        </ActionSetProvider>
      </ProposalOnGraphProvider>
    </GraphTraceProvider>
  );
}

function revisionOf(workflow: WorkspaceWorkflow | null): string | null {
  return workflow === null ? null : `${workflow.id}@${String(workflow.revision)}`;
}

type Tab = "chat" | "workflow";

type PaneProps = { workflow: WorkspaceWorkflow | null; customActions: CustomActionRecord[] };

function Split({ workflow, customActions, chat }: PaneProps & { chat: ReactNode }) {
  const trace = useGraphTrace();
  const drawn = useProposalOnGraph()?.drawn ?? null;
  const [tab, setTab] = useState<Tab>("chat");
  // Showing something new on the graph means looking at it.
  const reveal = drawn?.id ?? trace;
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal !== null) setTab("workflow");
  }
  // Both panels stay mounted (forceMount): the hidden one only isn't shown.
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === "chat" || value === "workflow") setTab(value);
      }}
      className="flex min-h-0 flex-1 flex-col gap-0 md:grid md:grid-cols-[minmax(320px,420px)_1fr]"
    >
      <TabsList
        variant="line"
        aria-label="Builder"
        className="grid h-auto w-full grid-cols-2 rounded-none border-b p-0 md:hidden"
      >
        <TabsTrigger value="chat" className="py-2.5">
          <MessageSquare aria-hidden /> Chat
        </TabsTrigger>
        <TabsTrigger value="workflow" className="py-2.5">
          <Workflow aria-hidden /> Workflow
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="chat"
        forceMount
        className="min-h-0 data-[state=inactive]:max-md:hidden md:border-r"
      >
        {chat}
      </TabsContent>
      <TabsContent
        value="workflow"
        forceMount
        className="min-h-0 min-w-0 data-[state=inactive]:max-md:hidden"
      >
        <GraphPane workflow={workflow} customActions={customActions} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * The graph, filling the right side. Its frame is the anchor for what slides over its right
 * edge, such as a side panel.
 */
function GraphPane({ workflow, customActions }: PaneProps) {
  const drawn = useProposalOnGraph()?.drawn ?? null;
  // A drawn proposal's steps may use the custom actions it brings, not stored until accepted.
  const drawnActions = useMemo(
    () => [...customActions, ...(drawn?.customActionRecords ?? [])],
    [customActions, drawn],
  );
  const revision = revisionOf(workflow);
  return (
    <section
      aria-label="Workflow"
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
    >
      {/* The working spec is edited on its graph, and kept, unsaved edits and all, while a
          proposal is drawn in its place: nothing is edited that's about to change. */}
      {workflow === null ? null : (
        <div className={cn("flex min-h-0 flex-1 flex-col", drawn !== null && "hidden")}>
          <WorkingSpecEditor key={revision} workflow={workflow} />
        </div>
      )}
      {workflow !== null && drawn === null ? null : (
        <ActionSetProvider customActions={drawnActions}>
          <WorkflowGraph
            spec={drawn === null ? null : drawn.baseSpec}
            proposal={drawn?.spec}
            placeholder
            fill
          >
            {drawn === null ? null : (
              <p
                role="status"
                className="absolute top-3 left-3 z-10 max-w-sm rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm"
              >
                <span className="font-medium">Showing the proposal</span> “{drawn.name}” as its
                changes. Accept or reject it in the chat.
              </p>
            )}
          </WorkflowGraph>
        </ActionSetProvider>
      )}
    </section>
  );
}
