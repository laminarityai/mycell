"use client";

// What "+" on the graph offers: the model steps, each action in the company's action set grouped
// by its app with its fixed risk level, and a branch. A draft's external send isn't offered as an
// action: a draft step writes it, and the policy engine adds its review. A send a tool step makes
// (edits suggested in a Doc, or booking a meeting) is offered, and the policy engine adds its
// review too.
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
    if (action.channel === "gmail_drafts") continue;
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

// A trigger that isn't repliable (a new invite) has no Gmail message to draft a reply to or
// hand over, so its menu offers neither.
function menuGroups(actions: ActionSet, repliable: boolean): { app: string; items: Item[] }[] {
  const steps = repliable
    ? STEPS
    : STEPS.filter((item) => item.kind.type !== "draft" && item.kind.type !== "escalate");
  return [
    { app: "Steps", items: steps },
    ...actionGroups(actions),
    { app: "Paths", items: [BRANCH] },
  ];
}

export function AddStepMenu({
  point,
  onPick,
  onClose,
  repliable = true,
}: {
  /** Where to open in the graph's frame: under the "+", kept inside the frame. */
  point: { left: number; top: number };
  onPick: (kind: NewStepKind) => void;
  onClose: () => void;
  /**
   * Whether the trigger starts runs on a Gmail message, which a draft replies to and an
   * escalation hands over: not so for a new invite, which offers neither.
   */
  repliable?: boolean;
}) {
  const actions = useActionSet();
  const groups = useMemo(() => menuGroups(actions, repliable), [actions, repliable]);
  const menu = useRef<HTMLDivElement>(null);
  // What had focus when the menu opened (the "+"), to hand it back when the menu closes unused.
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  const close = () => {
    onClose();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) {
      opener.current.focus();
    }
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Add a step"
      tabIndex={-1}
      style={point}
      className="nodrag nopan nowheel absolute z-30 max-h-[calc(100%-16px)] w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          return;
        }
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        const at = items.findIndex((item) => item === document.activeElement);
        const next = nextItem(event.key, at, items.length);
        if (next === null) return;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">Add a step</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close" onClick={close}>
          <X aria-hidden />
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.app} role="group" aria-label={group.app} className="border-t py-1">
          <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
            {group.app}
          </p>
          {group.items.map((item) => (
            <Button
              key={item.label}
              type="button"
              variant="ghost"
              role="menuitem"
              tabIndex={-1}
              className="h-auto w-full justify-between gap-2 px-2 py-1 font-normal focus-visible:bg-muted focus-visible:ring-0"
              onClick={() => {
                onPick(item.kind);
              }}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{item.hint}</span>
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Where an arrow key, Home or End moves focus among `count` items from `at`; null for other keys. */
function nextItem(key: string, at: number, count: number): number | null {
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return at <= 0 ? count - 1 : at - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
