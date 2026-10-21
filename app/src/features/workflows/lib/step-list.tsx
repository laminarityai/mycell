"use client";

// The form's steps, in order: one panel each with its issues, Move up, Move down and Remove,
// and the approvals the policy engine inserts, which aren't in the working spec and can't be
// removed. Add step goes at the end.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CatalogAction, InsertedApproval } from "@/features/policy/types";
import type { SpecDraft } from "@/features/spec/edit";
import { stepTypes, type SpecIssue, type StepType } from "@/features/spec/types";
import { IssueList, issuesAt, SelectField, text, TextField } from "./spec-fields";
import { StepFields } from "./step-fields";

export type StepListProps = {
  draft: SpecDraft;
  /** A stable key per step, so a step keeps its fields' state when steps move. */
  keys: readonly string[];
  issues: ReadonlyMap<number, SpecIssue[]>;
  inserted: readonly InsertedApproval[];
  actions: readonly CatalogAction[];
  onUpdate: (index: number, fields: Record<string, unknown>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onAdd: (type: StepType) => void;
};

const TYPE_NAMES: Record<StepType, string> = {
  classify: "Classify",
  branch: "Branch",
  extract: "Extract",
  tool: "Tool",
  draft: "Draft",
  approval: "Approval",
  escalate: "Escalate",
};

export function StepList(props: StepListProps) {
  const { draft, keys, issues, inserted } = props;
  const [adding, setAdding] = useState<StepType>("classify");
  return (
    <section aria-label="Steps" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Steps</h3>
      {draft.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      ) : null}
      {draft.steps.map((step, index) => (
        <div key={keys[index] ?? index} className="flex flex-col gap-3">
          <StepPanel
            draft={draft}
            actions={props.actions}
            onUpdate={props.onUpdate}
            onRemove={props.onRemove}
            onMove={props.onMove}
            index={index}
            issues={issues.get(index) ?? []}
          />
          {inserted
            .filter((approval) => approval.after === step.id)
            .map((approval) => (
              <InsertedApprovalPanel key={approval.stepId} approval={approval} />
            ))}
        </div>
      ))}
      <div className="flex items-end gap-2">
        <SelectField
          label="New step"
          value={adding}
          options={stepTypes.map((type) => ({ value: type, label: TYPE_NAMES[type] }))}
          onChange={(type) => {
            setAdding(type as StepType);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            props.onAdd(adding);
          }}
        >
          Add step
        </Button>
      </div>
    </section>
  );
}

type StepPanelProps = Pick<
  StepListProps,
  "draft" | "actions" | "onUpdate" | "onRemove" | "onMove"
> & {
  index: number;
  issues: SpecIssue[];
};

function StepPanel({ draft, index, issues, actions, onUpdate, onRemove, onMove }: StepPanelProps) {
  const step = draft.steps[index] ?? {};
  const id = text(step.id);
  const type = text(step.type);
  const name = type in TYPE_NAMES ? TYPE_NAMES[type as StepType] : type;
  return (
    <section
      aria-label={`Step ${id}`}
      className="flex flex-col gap-3 rounded-lg border p-3 data-[invalid=true]:border-destructive"
      data-invalid={issues.length > 0}
    >
      <header className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {String(index + 1)}. {name}
        </h4>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => {
              onMove(index, -1);
            }}
          >
            Move up
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={index === draft.steps.length - 1}
            onClick={() => {
              onMove(index, 1);
            }}
          >
            Move down
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onRemove(index);
            }}
          >
            Remove
          </Button>
        </div>
      </header>
      <TextField
        label="Step ID"
        value={step.id}
        invalid={issuesAt(issues, "id").length > 0}
        onChange={(value) => {
          onUpdate(index, { id: value });
        }}
      />
      <StepFields
        step={step}
        earlier={draft.steps.slice(0, index)}
        issues={issues}
        actions={actions}
        onChange={(fields) => {
          onUpdate(index, fields);
        }}
      />
      <IssueList issues={issues} label={`Issues with step ${id}`} />
    </section>
  );
}

/** An approval the policy engine adds after an external send: shown, but not editable. */
function InsertedApprovalPanel({ approval }: { approval: InsertedApproval }) {
  return (
    <section
      aria-label={`Step ${approval.stepId}`}
      className="flex flex-col gap-1 rounded-lg border border-dashed p-3 text-sm"
    >
      <h4 className="font-semibold">Approval</h4>
      <p>Waits for review (required by policy).</p>
      <p className="text-muted-foreground">
        <code className="font-mono">{approval.action}</code> sends outside the company, so a person
        reviews it before it goes. It can&apos;t be removed.
      </p>
    </section>
  );
}
