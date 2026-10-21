"use client";

// What every side panel form shares: what it's given, and its frame (the heading, the issues
// about what it edits, its fields, and removing it).
import { Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Spec, SpecIssue, Step } from "@/features/spec/types";
import type { GraphSelection } from "./graph-drawing";

/** Changes the working spec being edited. */
export type Edit = (change: (spec: Spec) => Spec) => void;

/** Changes the step a form edits. */
export type StepEdit = (change: (step: Step) => Step) => void;

export type PanelProps = {
  spec: Spec;
  edit: Edit;
  /** Live validation's issues, by the ID of the step or path each is about. */
  issues: ReadonlyMap<string, readonly SpecIssue[]>;
  onSelect: (selection: GraphSelection) => void;
  onClose: () => void;
};

export function PanelShell({
  title,
  subtitle,
  issues,
  onClose,
  onRemove,
  removeLabel = "Remove",
  removeWarning,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Live validation's issues about what the panel edits. */
  issues?: readonly SpecIssue[];
  onClose: () => void;
  /** Left out when it can't be removed; disabled with a reason as a string. */
  onRemove?: (() => void) | string;
  removeLabel?: string;
  /** What removing it takes with it, said under the button. */
  removeWarning?: string;
  children: ReactNode;
}) {
  const listed = issues ?? [];
  return (
    <>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle === undefined ? null : (
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close the editor"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {listed.length === 0 ? null : (
        <ul
          aria-label="Issues here"
          className="flex list-disc flex-col gap-1 rounded-md border border-red-200 bg-red-50/60 py-2 pr-2 pl-6 text-xs text-red-800"
        >
          {listed.map((issue) => (
            <li key={`${issue.path.join(".")}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      {children}
      {onRemove === undefined ? null : (
        <div className="flex flex-col gap-1 pt-1">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="self-start"
            disabled={typeof onRemove === "string"}
            onClick={typeof onRemove === "string" ? undefined : onRemove}
          >
            <Trash2 /> {removeLabel}
          </Button>
          {typeof onRemove === "string" ? (
            <p className="text-xs text-muted-foreground">{onRemove}</p>
          ) : removeWarning === undefined ? null : (
            <p className="text-xs text-muted-foreground">{removeWarning}</p>
          )}
        </div>
      )}
    </>
  );
}
