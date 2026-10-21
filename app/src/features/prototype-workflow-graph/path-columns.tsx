"use client";

// PROTOTYPE, never merge. Variant C's drawing: no nodes and lines. Each branch's paths are
// side-by-side columns with the condition as the column header, steps stacked inside, and a
// nested branch as columns within a column. Editing happens in place.
import { CircleCheck, Octagon, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import type { ListId, ViewPath, ViewStep } from "./model";
import {
  AddStepMenu,
  ChangeBadge,
  MoveButtons,
  PathRunSummary,
  ReviewBadge,
  RiskBadge,
  SelectionEditor,
  StepIcon,
  TriggerIcon,
  changeClasses,
} from "./parts";
import { usePrototype } from "./state";

type Insert = { listId: ListId; index: number };

export function PathColumns({ className }: { className?: string }) {
  const p = usePrototype();
  const selected = p.selection?.kind === "trigger";
  return (
    <div className={cn("h-full overflow-auto bg-muted/20 p-4 pb-24", className)}>
      <div className="mx-auto flex w-full flex-col items-stretch md:w-fit md:min-w-full">
        <div className="mx-auto w-full max-w-md">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (p.editable) p.select(selected ? null : { kind: "trigger" });
            }}
            className={cn(
              "cursor-pointer rounded-lg border bg-card px-3 py-2 shadow-sm",
              p.tryItOn && "border-emerald-500",
              selected && "ring-2 ring-primary",
            )}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <TriggerIcon /> Trigger
            </p>
            <p className="text-sm">When a message arrives in Gmail</p>
            {selected ? (
              <div
                className="mt-2 border-t pt-2"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <SelectionEditor
                  onDone={() => {
                    p.select(null);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        {p.view.empty ? (
          <>
            <Connector />
            <div className="mx-auto flex w-full max-w-md flex-col items-center gap-1 rounded-lg border-2 border-dashed bg-muted/30 px-4 py-8 text-center">
              <p className="text-sm font-medium">Your workflow will appear here</p>
              <p className="text-xs text-muted-foreground">
                Describe the work in the chat; accepted proposals are drawn here.
              </p>
            </div>
          </>
        ) : (
          <StepList
            steps={p.view.steps}
            start={{ listId: "root", index: 0 }}
            endLabel="End"
            narrow
          />
        )}
      </div>
    </div>
  );
}

function StepList({
  steps,
  start,
  endLabel,
  narrow = false,
}: {
  steps: ViewStep[];
  start: Insert | null;
  endLabel: string;
  /** The top level: keep single steps to a readable width. */
  narrow?: boolean;
}) {
  const p = usePrototype();
  // Where each "+" inserts: above each step, then under the last.
  const inserts = steps.reduce<(Insert | null)[]>(
    (all, view) => [...all, view.change === "removed" ? null : view.insertAfter],
    [start],
  );
  const insert = inserts.at(-1) ?? null;
  const items = steps.map((view, index) => {
    const here = inserts[index] ?? null;
    return (
      <div key={`${view.change ?? ""}:${view.id}`} className="flex flex-col">
        <Connector insert={p.editable ? here : null} />
        <div className={cn(narrow && "mx-auto w-full max-w-md")}>
          <StepCard view={view} />
        </div>
        {view.branch === null ? null : <Columns view={view} />}
      </div>
    );
  });
  const last = steps.at(-1);
  return (
    <>
      {items}
      {last?.branch != null ? null : (
        <>
          <Connector insert={p.editable ? insert : null} />
          <div className="mx-auto flex items-center gap-1 rounded-full border bg-background px-3 py-0.5 text-[11px] text-muted-foreground">
            {endLabel === "Stops here" ? <Octagon className="size-3" /> : null}
            {endLabel}
          </div>
        </>
      )}
    </>
  );
}

function StepCard({ view }: { view: ViewStep }) {
  const p = usePrototype();
  const selected = p.selection?.kind === "step" && p.selection.id === view.id;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (p.editable) p.select(selected ? null : { kind: "step", id: view.id });
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border bg-card px-3 py-2 shadow-sm transition-opacity",
        view.type === "branch" && "border-violet-300 bg-violet-50/60",
        view.byPolicy && "border-dashed bg-muted/40",
        changeClasses(view.change),
        view.run === "taken" && "border-emerald-500 ring-1 ring-emerald-500/40",
        view.run === "skipped" && "opacity-35",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <StepIcon step={view.step} />
        <span className="truncate">
          {view.type === "branch"
            ? `Branch · ${view.branch?.mode === "every" ? "every match" : "first match"}`
            : view.title}
        </span>
        <span className="ml-auto flex items-center gap-1 normal-case">
          <ChangeBadge change={view.change} />
          {view.run === "taken" ? <CircleCheck className="size-3.5 text-emerald-600" /> : null}
        </span>
      </div>
      <p className={cn("text-sm leading-snug", view.change === "removed" && "line-through")}>
        {view.text}
      </p>
      {view.before === null ? null : (
        <p className="text-[11px] text-muted-foreground">Before: {view.before}</p>
      )}
      {view.risk === null && view.type !== "approval" ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {view.risk === null ? null : <RiskBadge risk={view.risk} />}
          {view.type === "approval" ? <ReviewBadge byPolicy={view.byPolicy} /> : null}
        </div>
      )}
      {selected ? (
        <div
          className="mt-1 cursor-default border-t pt-2"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <SelectionEditor
            onDone={() => {
              p.select(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Columns({ view }: { view: ViewStep }) {
  const paths = view.branch?.paths ?? [];
  return (
    <div className="mt-3 flex flex-col items-stretch gap-2 md:flex-row md:items-start">
      {paths.map((path) => (
        <Column key={`${path.change ?? ""}:${path.id}`} path={path} />
      ))}
    </div>
  );
}

function Column({ path }: { path: ViewPath }) {
  const p = usePrototype();
  const selected = p.selection?.kind === "path" && p.selection.id === path.id;
  const run = path.run;
  return (
    <section
      aria-label={`Path: ${path.name}`}
      className={cn(
        "flex min-w-52 flex-1 flex-col rounded-xl border border-violet-200 bg-violet-50/40 p-2 transition-opacity",
        path.otherwise && "border-dashed bg-muted/40",
        changeClasses(path.change),
        run?.status === "taken" && "border-emerald-500 bg-emerald-50/50",
        (run?.status === "not-reached" ||
          run?.status === "not-checked" ||
          run?.status === "failed") &&
          "opacity-60",
      )}
    >
      <header
        role="button"
        tabIndex={0}
        onClick={() => {
          if (p.editable) p.select(selected ? null : { kind: "path", id: path.id });
        }}
        className={cn(
          "flex cursor-pointer flex-col gap-0.5 rounded-lg bg-background px-2 py-1.5 shadow-xs",
          selected && "ring-2 ring-primary",
        )}
      >
        <div className="flex items-center gap-1 text-xs font-semibold">
          <span className="truncate">
            {path.order === null ? "" : `${String(path.order.index + 1)}. `}
            {path.name}
          </span>
          <ChangeBadge change={path.change} />
          {path.order === null ? null : (
            <span className="ml-auto">
              <MoveButtons id={path.id} index={path.order.index} count={path.order.count} />
            </span>
          )}
        </div>
        <p className={cn("text-xs leading-snug", path.change === "removed" && "line-through")}>
          <span className="text-muted-foreground">When </span>
          {path.condition}
        </p>
        {path.before === null ? null : (
          <p className="text-[11px] text-muted-foreground">Before: {path.before}</p>
        )}
        <PathRunSummary run={run} otherwise={path.otherwise} />
        {selected ? (
          <div
            className="mt-1 cursor-default border-t pt-2"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <SelectionEditor
              onDone={() => {
                p.select(null);
              }}
            />
          </div>
        ) : null}
      </header>
      <StepList
        steps={path.steps}
        start={{ listId: path.listId, index: 0 }}
        endLabel={path.otherwise && path.steps.length === 0 ? "Stops here" : "End"}
      />
    </section>
  );
}

function Connector({ insert = null }: { insert?: Insert | null }) {
  const p = usePrototype();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex h-7 justify-center">
      <div className="h-full w-px bg-border" />
      {insert === null ? null : (
        <button
          type="button"
          aria-label="Add a step here"
          title="Add a step here"
          onClick={() => {
            setOpen(!open);
          }}
          className="absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
        >
          <Plus className="size-3" />
        </button>
      )}
      {open && insert !== null ? (
        <AddStepMenu
          className="absolute top-6 left-1/2 z-30 -translate-x-1/2"
          onClose={() => {
            setOpen(false);
          }}
          onPick={(kind) => {
            p.insert(insert.listId, insert.index, kind);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
