"use client";

// The working spec edited on its graph: clicking a box or a path opens the side panel on it,
// and "+" on a line adds a step there. Edits go to the draft the editor holds, by ID. The graph
// draws once the steps are valid, and goes on drawing them as edited while an edit leaves them
// invalid (a question cleared to retype it), each issue on the box or path it's about.
import { useMemo, useState } from "react";
import { issuesByTarget, readDraftTree, type SpecDraft } from "@/features/spec/draft";
import { insertStep, type InsertAt } from "@/features/spec/edit";
import { newStep, type NewStepKind } from "@/features/spec/new-step";
import { triggers } from "@/features/spec/triggers";
import type { Spec, SpecIssue, Step } from "@/features/spec/types";
import { AddStepMenu } from "./add-step-menu";
import { useGraphTrace } from "./graph-trace";
import { SidePanel } from "./side-panel";
import {
  selectedNodeId,
  WorkflowGraph,
  type GraphEditing,
  type GraphSelection,
} from "./workflow-graph";

type Menu = { at: InsertAt; left: number; top: number };

/** The menu's size, to keep it inside the graph's frame. */
const MENU_WIDTH = 256;
const MENU_HEIGHT = 440;

export function GraphEditor({
  draft,
  onChange,
  issues,
  fill = false,
}: {
  draft: SpecDraft;
  onChange: (draft: SpecDraft) => void;
  /** Live validation's issues with the draft. */
  issues: readonly SpecIssue[];
  /** The graph fills its parent's height. */
  fill?: boolean;
}) {
  const trace = useGraphTrace();
  const tree = useMemo(() => readDraftTree(draft), [draft]);
  const [lastGood, setLastGood] = useState(tree);
  if (tree !== null && tree !== lastGood) setLastGood(tree);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  // The draft's steps as they stand, valid or not, once they were valid: since then only the
  // edits here have changed them, so they keep a spec's shape.
  const base = useMemo((): Spec | null => {
    if (tree !== null) return tree;
    if (lastGood === null || draft.specVersion !== 2) return null;
    return { ...lastGood, steps: draft.steps as unknown as Step[] };
  }, [tree, lastGood, draft]);
  const edit = (change: (spec: Spec) => Spec) => {
    if (base === null) return;
    onChange({ ...draft, specVersion: 2, steps: change(base).steps });
  };
  const byId = useMemo(() => issuesByTarget(draft, issues).byId, [draft, issues]);

  const editing = useMemo(
    (): GraphEditing => ({
      selected: selectedNodeId(selection),
      onSelect: (next) => {
        setMenu(null);
        setSelection(next);
      },
      onAdd: (at, point) => {
        setMenu({
          at,
          left: Math.max(8, Math.min(point.x - MENU_WIDTH / 2, point.width - MENU_WIDTH - 8)),
          top: Math.max(8, Math.min(point.y + 14, point.height - MENU_HEIGHT - 8)),
        });
      },
      onPaneClick: () => {
        setMenu(null);
      },
      issues: byId,
    }),
    [selection, byId],
  );

  if (base === null) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        The graph shows the workflow once its steps are valid. Fix the issues below, or in the JSON
        view.
      </p>
    );
  }
  const add = (at: InsertAt, kind: NewStepKind) => {
    const step = newStep(base, at, kind);
    edit((spec) => insertStep(spec, at, step));
    setSelection({ kind: "step", id: step.id, byPolicy: false });
    setMenu(null);
  };
  return (
    <WorkflowGraph spec={base} trace={trace} editing={editing} fill={fill}>
      {base.steps.length === 0 ? (
        <p className="absolute top-3 left-3 z-10 max-w-xs rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm">
          No steps yet. Add one with “+”, write them in the JSON view, or ask the builder to propose
          them.
        </p>
      ) : null}
      {menu === null ? null : (
        <AddStepMenu
          point={{ left: menu.left, top: menu.top }}
          repliable={triggers[base.trigger.type].repliable}
          onPick={(kind) => {
            add(menu.at, kind);
          }}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
      {selection === null ? null : (
        <SidePanel
          selection={selection}
          spec={base}
          edit={edit}
          issues={byId}
          onSelect={setSelection}
          onClose={() => {
            setSelection(null);
          }}
        />
      )}
    </WorkflowGraph>
  );
}
