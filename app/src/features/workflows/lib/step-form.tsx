"use client";

// The side panel's form for a step: its fields by its type, each change applied to the working
// spec by the step's ID. Its ID and, for an action, its risk level are shown, never edited: the
// ID is what other steps name, and only the catalog decides a risk level (invariant 4).
import { ShieldCheck } from "lucide-react";
import { removeStep, updateStep } from "@/features/spec/edit";
import { findStep, stepLocation } from "@/features/spec/tree";
import type { Step } from "@/features/spec/types";
import { useActionSet } from "./action-set-context";
import { BranchFields } from "./branch-fields";
import { RiskBadge } from "./risk-badge";
import { PanelShell, type PanelProps, type StepEdit } from "./panel-shell";
import { ListField, SelectField, TextField } from "./spec-fields";
import { ExtractFields, ToolInputs } from "./step-inputs";

const TITLES: Record<Step["type"], string> = {
  classify: "Classify",
  extract: "Extract",
  tool: "Action",
  draft: "Draft a reply",
  approval: "Waits for review",
  escalate: "Hand to a person",
  branch: "Branch",
};

const ROLES = ["classify", "fast", "smart", "judge"].map((role) => ({ value: role, label: role }));

export function StepForm({ stepId, ...props }: PanelProps & { stepId: string }) {
  const { spec, edit, issues, onClose } = props;
  const actions = useActionSet();
  const step = findStep(spec, stepId);
  if (step === undefined) {
    return (
      <PanelShell title="Not in the workflow" onClose={onClose}>
        <p className="text-sm text-muted-foreground">
          This step isn&apos;t in the workflow any more.
        </p>
      </PanelShell>
    );
  }
  const update: StepEdit = (change) => {
    edit((current) => updateStep(current, step.id, change));
  };
  const here = issues.get(step.id) ?? [];
  const depth = stepLocation(spec, step.id)?.length ?? 0;
  const invalid = (field: string) => here.some((issue) => issue.path[depth] === field);
  const action = actions.find(step.type === "tool" ? step.action : "");
  const risk = step.type === "draft" ? actions.find(step.output)?.risk : action?.risk;
  return (
    <PanelShell
      title={action === undefined ? TITLES[step.type] : `${action.app} · ${TITLES[step.type]}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-1">
          <code className="font-mono">{step.id}</code>
          {risk === undefined ? null : (
            <>
              · <RiskBadge risk={risk} /> <span>from the catalog</span>
            </>
          )}
        </span>
      }
      issues={here}
      onClose={onClose}
      onRemove={() => {
        edit((current) => removeStep(current, step.id));
        onClose();
      }}
      removeLabel={step.type === "branch" ? "Remove the branch" : "Remove step"}
      removeWarning={
        step.type === "branch"
          ? "The steps on its named paths go with it. The otherwise path's steps stay, where the branch stood."
          : undefined
      }
    >
      <Fields step={step} update={update} invalid={invalid} {...props} />
    </PanelShell>
  );
}

function Fields({
  step,
  update,
  invalid,
  ...props
}: PanelProps & { step: Step; update: StepEdit; invalid: (field: string) => boolean }) {
  const set = (fields: Partial<Step>) => {
    update((current) => ({ ...current, ...fields }) as Step);
  };
  const role =
    "role" in step ? (
      <SelectField
        label="Model role"
        value={step.role}
        options={ROLES}
        onChange={(value) => {
          set({ role: value } as Partial<Step>);
        }}
      />
    ) : null;
  switch (step.type) {
    case "classify":
      return (
        <>
          <TextField
            label="Question"
            value={step.question}
            multiline
            invalid={invalid("question")}
            onChange={(question) => {
              set({ question });
            }}
          />
          <ListField
            key={step.id}
            label="Answers (comma-separated)"
            value={step.labels}
            invalid={invalid("labels")}
            onChange={(labels) => {
              set({ labels });
            }}
          />
          {role}
        </>
      );
    case "extract":
      return (
        <>
          <ExtractFields step={step} update={update} invalid={invalid("fields")} />
          {role}
        </>
      );
    case "tool":
      return <ToolInputs step={step} update={update} invalid={invalid("input")} />;
    case "draft":
      return (
        <>
          <TextField
            label="Instructions"
            value={step.instructions}
            multiline
            invalid={invalid("instructions")}
            onChange={(instructions) => {
              set({ instructions });
            }}
          />
          <ListField
            key={step.id}
            label="Reads (comma-separated)"
            value={step.context}
            invalid={invalid("context")}
            onChange={(context) => {
              set({ context });
            }}
          />
          {role}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden className="size-3" /> A review follows this step: policy adds
            one after every external send.
          </p>
        </>
      );
    case "approval":
      return <p className="text-sm">A person sends or deletes the draft above it in Gmail.</p>;
    case "escalate":
      return (
        <TextField
          label="Why a person should look"
          value={step.reason}
          multiline
          invalid={invalid("reason")}
          onChange={(reason) => {
            set({ reason });
          }}
        />
      );
    case "branch":
      return <BranchFields branch={step} {...props} />;
  }
}
