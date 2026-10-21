"use client";

// The panels whose fields are a record: a tool step's action and its input, and an extract
// step's fields.
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { findAction } from "@/features/policy/catalog";
import {
  issuesAt,
  record,
  SelectField,
  text,
  TextField,
  type StepFieldsProps,
} from "./spec-fields";

const FROM = /^[a-z][a-z0-9_-]*\.[A-Za-z0-9_.-]+$/;

/** A catalog action, picked from those the connection allows, and a value for each input. */
export function ToolFields({ step, issues, actions, onChange }: StepFieldsProps) {
  const input = record(step.input);
  const invalid = (...path: (string | number)[]) => issuesAt(issues, ...path).length > 0;
  return (
    <>
      <SelectField
        label="Action"
        value={step.action}
        options={actions.map((action) => ({
          value: action.name,
          label: `${action.app}: ${action.description}`,
        }))}
        invalid={invalid("action")}
        onChange={(name) => {
          onChange({ action: name, input: inputFor(name, input) });
        }}
      />
      {Object.entries(input).map(([name, value]) => (
        <InputValue
          key={name}
          name={name}
          value={value}
          invalid={invalid("input", name)}
          onChange={(next) => {
            onChange({ input: { ...input, [name]: next } });
          }}
        />
      ))}
    </>
  );
}

/**
 * One input: text as typed, or a reference to an earlier step's output or the trigger, written
 * `<step>.<field>`. Numbers, lists and the like are edited in the JSON view.
 */
function InputValue({
  name,
  value,
  invalid,
  onChange,
}: {
  name: string;
  value: unknown;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) {
  const from = record(value).from;
  if (typeof value !== "string" && typeof from !== "string") {
    return (
      <p className="text-sm">
        <span className="font-medium">{name}</span>:{" "}
        <code className="font-mono">{JSON.stringify(value)}</code> (edit it in the JSON view)
      </p>
    );
  }
  const reference = typeof from === "string";
  return (
    <div className="grid grid-cols-[10rem_1fr] items-end gap-2">
      <SelectField
        label={`${name} is`}
        value={reference ? "from" : "text"}
        options={[
          { value: "text", label: "Text" },
          { value: "from", label: "From a step" },
        ]}
        onChange={(kind) => {
          const current = reference ? from : text(value);
          onChange(kind === "from" ? { from: FROM.test(current) ? current : "" } : current);
        }}
      />
      <TextField
        label={reference ? `${name} (step.field)` : name}
        value={reference ? from : value}
        invalid={invalid}
        onChange={(typed) => {
          onChange(reference ? { from: typed } : typed);
        }}
      />
    </div>
  );
}

// The action's inputs, keeping the values already given for any it shares with the old one.
function inputFor(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const schema = findAction(name)?.input;
  if (!(schema instanceof z.ZodObject)) return input;
  const fields = Object.keys(schema.shape);
  return Object.fromEntries(fields.map((field) => [field, input[field] ?? ""]));
}

const FIELD_TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes or no" },
];

/** The fields an extract step reads from the message: each a name, a type and a description. */
export function ExtractFields({ step, issues, onChange }: StepFieldsProps) {
  const entries = Object.entries(record(step.fields));
  const invalid = (...path: (string | number)[]) => issuesAt(issues, ...path).length > 0;
  const set = (next: [string, unknown][]) => {
    onChange({ fields: Object.fromEntries(next) });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Fields</legend>
      {entries.map(([name, value], index) => {
        const field = record(value);
        const replace = (entry: [string, unknown]) => {
          set(entries.map((other, at) => (at === index ? entry : other)));
        };
        return (
          // Rows are keyed by position, so renaming a field keeps its row (and focus).
          <div key={index} className="grid grid-cols-[1fr_8rem_2fr_auto] items-end gap-2">
            <TextField
              label="Name"
              value={name}
              invalid={invalid("fields", name)}
              onChange={(renamed) => {
                replace([renamed, field]);
              }}
            />
            <SelectField
              label="Type"
              value={field.type}
              options={FIELD_TYPES}
              onChange={(type) => {
                replace([name, { ...field, type }]);
              }}
            />
            <TextField
              label="Description"
              value={text(field.description)}
              onChange={(description) => {
                replace([name, { ...field, description }]);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                set(entries.filter((_, at) => at !== index));
              }}
            >
              Remove field
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            set([
              ...entries,
              [`field${String(entries.length + 1)}`, { type: "string", description: "" }],
            ]);
          }}
        >
          Add field
        </Button>
      </div>
    </fieldset>
  );
}
