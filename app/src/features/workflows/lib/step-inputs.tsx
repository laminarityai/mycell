"use client";

// The side panel's longer step fields: an extract step's fields, and a tool step's inputs.
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { isReference } from "@/features/spec/input-values";
import type { Step } from "@/features/spec/types";
import type { StepEdit } from "./panel-shell";

type ExtractStep = Extract<Step, { type: "extract" }>;
type Tool = Extract<Step, { type: "tool" }>;
type ExtractedField = ExtractStep["fields"][string];

/** Each field an extract step reads: its name, type and description, in order. */
export function ExtractFields({
  step,
  update,
  invalid,
}: {
  step: ExtractStep;
  update: StepEdit;
  invalid: boolean;
}) {
  const entries = Object.entries(step.fields);
  const setFields = (next: [string, ExtractedField][]) => {
    update((current) => ({ ...current, fields: Object.fromEntries(next) }) as Step);
  };
  const change = (index: number, name: string, field: ExtractedField) => {
    setFields(entries.map((entry, at) => (at === index ? [name, field] : entry)));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Fields to read</legend>
      {entries.map(([name, field], index) => (
        <div key={index} className="flex flex-col gap-1 rounded-md border p-2">
          <div className="flex gap-1">
            <Input
              aria-label="Field name"
              aria-invalid={invalid}
              value={name}
              className="font-mono text-xs"
              onChange={(event) => {
                change(index, event.target.value, field);
              }}
            />
            <NativeSelect
              aria-label="Field type"
              className="w-28"
              value={field.type}
              onChange={(event) => {
                const type = event.target.value as ExtractedField["type"];
                change(index, name, { ...field, type });
              }}
            >
              <NativeSelectOption value="string">text</NativeSelectOption>
              <NativeSelectOption value="number">number</NativeSelectOption>
              <NativeSelectOption value="boolean">yes/no</NativeSelectOption>
            </NativeSelect>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove field ${name}`}
              disabled={entries.length === 1}
              onClick={() => {
                setFields(entries.filter((_, at) => at !== index));
              }}
            >
              <X />
            </Button>
          </div>
          <Input
            aria-label="Field description"
            value={field.description}
            className="text-xs"
            onChange={(event) => {
              change(index, name, { ...field, description: event.target.value });
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() => {
          const taken = new Set(entries.map(([name]) => name));
          let name = "field";
          for (let n = 2; taken.has(name); n += 1) name = `field${String(n)}`;
          setFields([...entries, [name, { type: "string", description: "" }]]);
        }}
      >
        Add a field
      </Button>
    </fieldset>
  );
}

/**
 * Each input the action takes: text typed as it's sent, or a value read from the trigger or a
 * step above (`<step>.<field>`). A list or a record is edited in the JSON view.
 */
export function ToolInputs({
  step,
  update,
  invalid,
}: {
  step: Tool;
  update: StepEdit;
  invalid: boolean;
}) {
  const set = (name: string, value: Tool["input"][string]) => {
    update((current) =>
      current.type === "tool"
        ? { ...current, input: { ...current.input, [name]: value } }
        : current,
    );
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Inputs</legend>
      {Object.entries(step.input).map(([name, value]) => {
        if (value !== null && typeof value === "object" && !isReference(value)) {
          return (
            <p key={name} className="text-xs text-muted-foreground">
              <code className="font-mono">{name}</code>:{" "}
              {Array.isArray(value) ? "a list" : "a record"}, edited in the JSON view.
            </p>
          );
        }
        const reference = isReference(value) ? value : undefined;
        const literal = isReference(value) || typeof value === "object" ? null : value;
        return (
          <label key={name} className="flex flex-col gap-1 text-sm font-medium">
            {reference ? `${name} (read from)` : name}
            <Input
              aria-invalid={invalid}
              value={reference ? reference.from : literal === null ? "" : String(literal)}
              className={reference ? "font-mono text-xs" : undefined}
              onChange={(event) => {
                const typed = event.target.value;
                set(
                  name,
                  reference ? { from: typed } : typeof literal === "number" ? Number(typed) : typed,
                );
              }}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
