"use client";

// One panel per step type: the fields of one step of the draft. Each change hands the step's
// changed fields up; a field set to undefined is removed.
import { modelRoleSchema } from "@/features/spec/types";
import {
  issuesAt,
  ListField,
  NumberField,
  record,
  SelectField,
  text,
  TextField,
  type Option,
  type StepFieldsProps,
} from "./spec-fields";
import { ExtractFields, ToolFields } from "./tool-step-fields";

const ROLES: Option[] = modelRoleSchema.options.map((role) => ({ value: role, label: role }));

export function StepFields(props: StepFieldsProps) {
  const { step, issues, onChange } = props;
  const invalid = (...path: (string | number)[]) => issuesAt(issues, ...path).length > 0;
  const role = (
    <SelectField
      label="Model role"
      value={step.role}
      options={ROLES}
      invalid={invalid("role")}
      onChange={(value) => {
        onChange({ role: value });
      }}
    />
  );
  switch (step.type) {
    case "classify":
      return (
        <>
          {role}
          <TextField
            label="Question"
            value={step.question}
            invalid={invalid("question")}
            onChange={(question) => {
              onChange({ question });
            }}
          />
          <ListField
            label="Labels (comma-separated)"
            value={step.labels}
            invalid={invalid("labels")}
            onChange={(labels) => {
              onChange({ labels });
            }}
          />
          <NumberField
            label="Check: fail the run below confidence (0 to 1)"
            value={record(step.checks).minP}
            min={0}
            max={1}
            step={0.05}
            invalid={invalid("checks")}
            onChange={(minP) => {
              const checks = { ...record(step.checks), minP };
              const kept = Object.values(checks).some((value) => value !== undefined);
              onChange({ checks: kept ? checks : undefined });
            }}
          />
        </>
      );
    case "branch":
      return <BranchFields {...props} />;
    case "extract":
      return (
        <>
          {role}
          <ExtractFields {...props} />
        </>
      );
    case "tool":
      return <ToolFields {...props} />;
    case "draft":
      return (
        <>
          {role}
          <TextField
            label="Instructions"
            multiline
            value={step.instructions}
            invalid={invalid("instructions")}
            onChange={(instructions) => {
              onChange({ instructions });
            }}
          />
          <ListField
            label="Context (step IDs, trigger.message or trigger.thread)"
            value={step.context}
            invalid={invalid("context")}
            onChange={(context) => {
              onChange({ context });
            }}
          />
          <SelectField
            label="Writes"
            value={step.output}
            options={props.actions
              .filter((action) => action.pendingForm !== undefined)
              .map((action) => ({ value: action.name, label: action.description }))}
            invalid={invalid("output")}
            onChange={(output) => {
              onChange({ output });
            }}
          />
        </>
      );
    case "approval":
      return (
        <p className="text-sm text-muted-foreground">
          Waits for a person to review the Gmail draft and send it.
        </p>
      );
    case "escalate":
      return (
        <TextField
          label="Reason"
          value={step.reason}
          invalid={invalid("reason")}
          onChange={(reason) => {
            onChange({ reason });
          }}
        />
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          The form can&apos;t show this step&apos;s type. Edit it in the JSON view.
        </p>
      );
  }
}

/** Goes on when an earlier classify step gave a label with enough confidence. */
function BranchFields({ step, earlier, issues, onChange }: StepFieldsProps) {
  const when = record(step.when);
  const invalid = (...path: (string | number)[]) => issuesAt(issues, ...path).length > 0;
  const classifies = earlier.filter((other) => other.type === "classify");
  const source = classifies.find((other) => other.id === when.step);
  const labels = Array.isArray(source?.labels) ? source.labels.map(String) : [];
  const setWhen = (fields: Record<string, unknown>) => {
    onChange({ when: { ...when, ...fields } });
  };
  return (
    <>
      <SelectField
        label="When step"
        value={when.step}
        options={classifies.map((other) => ({ value: text(other.id), label: text(other.id) }))}
        invalid={invalid("when", "step")}
        onChange={(value) => {
          setWhen({ step: value });
        }}
      />
      {labels.length > 0 ? (
        <SelectField
          label="Says"
          value={when.label}
          options={labels.map((label) => ({ value: label, label }))}
          invalid={invalid("when", "label")}
          onChange={(label) => {
            setWhen({ label });
          }}
        />
      ) : (
        <TextField
          label="Says"
          value={when.label}
          invalid={invalid("when", "label")}
          onChange={(label) => {
            setWhen({ label });
          }}
        />
      )}
      <NumberField
        label="Go on only with confidence at least (0 to 1)"
        value={when.minP}
        min={0}
        max={1}
        step={0.05}
        invalid={invalid("when", "minP")}
        onChange={(minP) => {
          setWhen({ minP });
        }}
      />
      <SelectField
        label="Otherwise"
        value={step.else}
        options={[
          { value: "stop", label: "Stop" },
          { value: "escalate", label: "Hand the message to a person" },
        ]}
        invalid={invalid("else")}
        onChange={(value) => {
          onChange({ else: value });
        }}
      />
    </>
  );
}
