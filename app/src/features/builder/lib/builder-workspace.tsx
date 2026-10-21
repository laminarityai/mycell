"use client";

// The builder conversation as a split screen: the chat on the left, the workflow's graph on the
// right (its working spec, a waiting proposal drawn as its changes, or a Try it's route).
// Under 768px the two become tabs, Chat and Workflow, which turn to Workflow when a proposal or
// a Try it is shown. Both stay mounted, so a turn streams on while the graph is looked at.
import { MessageSquare, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Spec } from "@/features/spec/types";
import {
  GraphTraceProvider,
  useGraphTrace,
  useShowOnGraph,
  WorkflowGraph,
} from "@/features/workflows/ui";
import { cn } from "@/lib/utils";
import type { Proposal } from "../types";
import { ProposalOnGraphProvider, useProposalOnGraph } from "./proposal-on-graph";

export type WorkspaceWorkflow = { id: string; workingSpec: Spec; revision: number };

export function BuilderWorkspace({
  proposals,
  workflow,
  chat,
}: {
  proposals: Proposal[];
  /** The conversation's workflow; null until a proposal for a new one is accepted. */
  workflow: WorkspaceWorkflow | null;
  chat: ReactNode;
}) {
  return (
    <GraphTraceProvider>
      <ProposalOnGraphProvider proposals={proposals}>
        <Split workflow={workflow} chat={chat} />
      </ProposalOnGraphProvider>
    </GraphTraceProvider>
  );
}

type Tab = "chat" | "workflow";

const TABS: { id: Tab; label: string; Icon: typeof Workflow }[] = [
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "workflow", label: "Workflow", Icon: Workflow },
];

function Split({ workflow, chat }: { workflow: WorkspaceWorkflow | null; chat: ReactNode }) {
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
  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(320px,420px)_1fr]">
      <div role="tablist" aria-label="Builder" className="grid grid-cols-2 border-b md:hidden">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`builder-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`builder-panel-${id}`}
            onClick={() => {
              setTab(id);
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium",
              tab === id ? "border-b-2 border-primary" : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" /> {label}
          </button>
        ))}
      </div>
      <div
        id="builder-panel-chat"
        className={cn("min-h-0 flex-1 md:border-r", tab !== "chat" && "max-md:hidden")}
      >
        {chat}
      </div>
      <div
        id="builder-panel-workflow"
        className={cn("min-h-0 min-w-0 flex-1", tab !== "workflow" && "max-md:hidden")}
      >
        <GraphPane workflow={workflow} />
      </div>
    </div>
  );
}

/**
 * The graph, filling the right side. Its frame is the anchor for what slides over its right
 * edge, such as a side panel.
 */
function GraphPane({ workflow }: { workflow: WorkspaceWorkflow | null }) {
  const trace = useGraphTrace();
  const showTrace = useShowOnGraph();
  const drawn = useProposalOnGraph()?.drawn ?? null;
  // A Try it was of the working spec before it changed.
  const revision = workflow === null ? null : `${workflow.id}@${String(workflow.revision)}`;
  useEffect(() => {
    showTrace?.(null);
  }, [revision, showTrace]);
  return (
    <section aria-label="Workflow" className="relative h-full min-h-0 overflow-hidden">
      <WorkflowGraph
        spec={drawn === null ? (workflow?.workingSpec ?? null) : drawn.baseSpec}
        proposal={drawn?.spec}
        trace={drawn === null ? trace : null}
        placeholder
        fill
      >
        {drawn === null ? null : (
          <p
            role="status"
            className="absolute top-3 left-3 z-10 max-w-sm rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm"
          >
            <span className="font-medium">Showing the proposal</span> “{drawn.name}” as its changes.
            Accept or reject it in the chat.
          </p>
        )}
      </WorkflowGraph>
    </section>
  );
}
