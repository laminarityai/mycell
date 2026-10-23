"use client";

// The workflow editor's form fields. Each edits one value of a draft, which needn't be valid
// yet, and is marked invalid when live validation has an issue at its path.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { SpecIssue } from "@/features/spec/types";

type Path = (string | number)[];

/** The issues at `path` or inside it. */
export function issuesAt(issues: readonly SpecIssue[], ...path: Path): SpecIssue[] {
  return issues.filter((issue) => path.every((key, i) => issue.path[i] === key));
}

/** A draft's value as text for a field: strings as they are, anything else as blank. */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A draft's value as an object, or an empty one. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const LABEL = "flex flex-col gap-1 text-sm font-medium";

export function TextField({
  label,
  value,
  onChange,
  invalid = false,
  multiline = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  invalid?: boolean;
  multiline?: boolean;
}) {
  const props = {
    value: text(value),
    "aria-invalid": invalid,
    onChange: (event: { target: { value: string } }) => {
      onChange(event.target.value);
    },
  };
  return (
    <label className={LABEL}>
      {label}
      {multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
    </label>
  );
}

/** A number, or undefined once cleared. */
export function NumberField({
  label,
  value,
  onChange,
  invalid = false,
  min,
  max,
  step,
}: {
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  invalid?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className={LABEL}>
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={typeof value === "number" ? value : ""}
        aria-invalid={invalid}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
      />
    </label>
  );
}

export type Option = { value: string; label: string };

/** A choice of `options`; a draft value that isn't one of them is shown as its own option. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  invalid = false,
}: {
  label: string;
  value: unknown;
  options: readonly Option[];
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const current =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  const all = options.some((option) => option.value === current)
    ? options
    : [{ value: current, label: current === "" ? "Choose…" : current }, ...options];
  return (
    <label className={LABEL}>
      {label}
      <NativeSelect
        className="w-full"
        value={current}
        aria-invalid={invalid}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {all.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}

/**
 * A list of strings typed comma-separated. It keeps the admin's text while they type, so a
 * trailing comma stays; the draft gets the trimmed, non-empty items.
 */
export function ListField({
  label,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string[]) => void;
  invalid?: boolean;
}) {
  const items = Array.isArray(value) ? value.map(String) : [];
  const [typed, setTyped] = useState(items.join(", "));
  return (
    <label className={LABEL}>
      {label}
      <Input
        value={typed}
        aria-invalid={invalid}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== ""),
          );
        }}
      />
    </label>
  );
}

/** A list of issues, each at its path inside what the list is about. */
export function IssueList({ issues, label }: { issues: readonly SpecIssue[]; label: string }) {
  if (issues.length === 0) return null;
  return (
    <ul aria-label={label} className="flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
      {issues.map((issue) => (
        <li key={`${issue.path.join(".")}:${issue.message}`}>
          {issue.path.length > 0 ? (
            <code className="mr-1 font-mono">{issue.path.join(".")}</code>
          ) : null}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
