"use client";

// What "+" on the graph offers: the model steps, each action in the company's action set grouped
// by its app with its fixed risk level, and a branch. A draft's external send isn't offered as an
// action: a draft step writes it, and the policy engine adds its review.
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import type { ActionSet } from "@/features/policy/types";
import type { NewStepKind } from "@/features/spec/new-step";
import { useActionSet } from "./action-set-context";
import { riskLabel } from "./risk-badge";

type Item = { label: string; hint: string; kind: NewStepKind };

const STEPS: Item[] = [
  { label: "Classify", hint: "Sort the message into answers", kind: { type: "classify" } },
  { label: "Extract", hint: "Read values out of the message", kind: { type: "extract" } },
  { label: "Draft a reply", hint: "Waits for review (policy)", kind: { type: "draft" } },
  { label: "Hand to a person", hint: "Stop and pass it on", kind: { type: "escalate" } },
];

const BRANCH: Item = { label: "Branch", hint: "Split into paths", kind: { type: "branch" } };

/** The actions a tool step may run, grouped by app, in the action set's order. */
function actionGroups(actions: ActionSet): { app: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>();
  for (const action of actions.actions) {
    if (action.pendingForm !== undefined) continue;
    const verb = action.name.split(".").at(-1)?.replaceAll("-", " ") ?? action.name;
    const label = `${action.app} · ${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
    const inputs = action.input instanceof z.ZodObject ? Object.keys(action.input.shape) : [];
    const item = { label, hint: riskLabel(action.risk), kind: toolKind(action.name, inputs) };
    groups.set(action.app, [...(groups.get(action.app) ?? []), item]);
  }
  return [...groups].map(([app, items]) => ({ app, items }));
}

function toolKind(action: string, inputs: string[]): NewStepKind {
  return { type: "tool", action, inputs };
}

function menuGroups(actions: ActionSet): { app: string; items: Item[] }[] {
  return [
    { app: "Steps", items: STEPS },
    ...actionGroups(actions),
    { app: "Paths", items: [BRANCH] },
  ];
}

export function AddStepMenu({
  point,
  onPick,
  onClose,
}: {
  /** Where to open in the graph's frame: under the "+", kept inside the frame. */
  point: { left: number; top: number };
  onPick: (kind: NewStepKind) => void;
  onClose: () => void;
}) {
  const actions = useActionSet();
  const groups = useMemo(() => menuGroups(actions), [actions]);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div
      role="menu"
      aria-label="Add a step"
      style={point}
      className="nodrag nopan nowheel absolute z-30 max-h-[calc(100%-16px)] w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">Add a step</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded p-0.5 hover:bg-muted"
        >
          <X aria-hidden className="size-3" />
        </button>
      </div>
      {groups.map((group, g) => (
        <div key={group.app} role="group" aria-label={group.app} className="border-t py-1">
          <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
            {group.app}
          </p>
          {group.items.map((item, i) => (
            <button
              key={item.label}
              ref={g === 0 && i === 0 ? first : undefined}
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => {
                onPick(item.kind);
              }}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{item.hint}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
