"use client";

// PROTOTYPE, never merge. The three layouts. Each keeps its own arrangement; they share only the
// mock state, the chat, the editors and the drawings.
import { ArrowLeft, MessageSquare, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { FlowGraph } from "./flow-graph";
import { MockChat, SelectionEditor, TryItMessage, useIsNarrow } from "./parts";
import { PathColumns } from "./path-columns";
import { usePrototype } from "./state";

function ChatHeader() {
  const p = usePrototype();
  return (
    <header className="flex items-baseline justify-between gap-2">
      <h1 className="text-lg font-semibold tracking-tight">Builder chat</h1>
      <span className="truncate text-xs text-muted-foreground">
        {p.spec === null ? "No workflow yet" : p.spec.name}
      </span>
    </header>
  );
}

/** Below 768px every variant becomes two tabs: Chat and Workflow. */
function NarrowTabs({ chat, workflow }: { chat: ReactNode; workflow: ReactNode }) {
  const p = usePrototype();
  const [tab, setTab] = useState<"chat" | "workflow">("workflow");
  // Showing a proposal on the graph means looking at the graph.
  useEffect(() => {
    if (p.showingProposal || p.tryItOn) setTab("workflow");
  }, [p.showingProposal, p.tryItOn]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="grid grid-cols-2 border-b bg-background text-sm">
        {(
          [
            ["chat", "Chat", MessageSquare],
            ["workflow", "Workflow", Workflow],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 py-2.5 font-medium",
              tab === id ? "border-b-2 border-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">{tab === "chat" ? chat : workflow}</div>
    </div>
  );
}

/** The editor as a sheet over the whole graph, for narrow screens. */
function NarrowEditor() {
  const p = usePrototype();
  if (p.selection === null) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[75%] overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-20 shadow-2xl">
      <SelectionEditor
        onDone={() => {
          p.select(null);
        }}
      />
    </div>
  );
}

// A: Split + side panel -------------------------------------------------------------------------

export function VariantA() {
  const p = usePrototype();
  const narrow = useIsNarrow();
  const chat = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <ChatHeader />
      <MockChat className="flex-1" />
    </div>
  );
  const graph = (
    <div className="relative h-full overflow-hidden">
      <FlowGraph />
      <TryItMessage className="absolute top-3 left-3 z-10 max-w-sm" />
      {narrow ? (
        <NarrowEditor />
      ) : (
        <aside
          aria-label="Edit"
          className={cn(
            "absolute top-0 right-0 bottom-0 z-20 w-[360px] overflow-y-auto border-l bg-background p-4 shadow-xl transition-transform duration-200",
            p.selection === null ? "translate-x-full" : "translate-x-0",
          )}
        >
          <SelectionEditor
            onDone={() => {
              p.select(null);
            }}
          />
        </aside>
      )}
    </div>
  );
  if (narrow) return <NarrowTabs chat={chat} workflow={graph} />;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,400px)_1fr]">
      <div className="min-h-0 border-r">{chat}</div>
      {graph}
    </div>
  );
}

// B: Graph first --------------------------------------------------------------------------------

export function VariantB() {
  const p = usePrototype();
  const narrow = useIsNarrow();
  const inspecting = p.selection !== null;
  const column = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {inspecting ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              p.select(null);
            }}
          >
            <ArrowLeft /> Back to chat
          </Button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SelectionEditor />
          </div>
        </>
      ) : (
        <>
          <ChatHeader />
          <MockChat className="flex-1" />
        </>
      )}
    </div>
  );
  const graph = (
    <div className="relative h-full overflow-hidden">
      <FlowGraph fitPadding={{ top: "84px", bottom: "84px", x: "24px" }} />
      <div className="pointer-events-none absolute top-3 right-3 left-3 z-10 hidden justify-between gap-3 md:flex">
        <div className="pointer-events-auto rounded-lg border bg-background/95 px-3 py-1.5 shadow-sm">
          <p className="text-sm font-semibold">{p.spec?.name ?? "New workflow"}</p>
          <p className="text-[11px] text-muted-foreground">
            {p.showingProposal ? "Showing the pending proposal" : "Working spec · not published"}
          </p>
        </div>
        <TryItMessage className="pointer-events-auto max-w-sm" />
      </div>
      {narrow ? <NarrowEditor /> : null}
    </div>
  );
  if (narrow) return <NarrowTabs chat={column} workflow={graph} />;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-[320px] shrink-0 border-r bg-background">{column}</div>
      <div className="min-w-0 flex-1">{graph}</div>
    </div>
  );
}

// C: Path columns -------------------------------------------------------------------------------

export function VariantC() {
  const narrow = useIsNarrow();
  const chat = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <ChatHeader />
      <MockChat className="flex-1" />
    </div>
  );
  const columns = (
    <div className="flex h-full flex-col">
      <TryItMessage className="m-3 mb-0 rounded-lg" />
      <PathColumns className="min-h-0 flex-1" />
    </div>
  );
  if (narrow) return <NarrowTabs chat={chat} workflow={columns} />;
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,400px)_1fr]">
      <div className="min-h-0 border-r">{chat}</div>
      <div className="min-h-0 min-w-0">{columns}</div>
    </div>
  );
}
