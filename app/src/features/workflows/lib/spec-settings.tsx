"use client";

// The top of the form: the spec's ID, whose credentials it runs with, its trigger and its rung.
import type { SpecDraft } from "@/features/spec/draft";
import type { SpecIssue } from "@/features/spec/types";
import { issuesAt, ListField, NumberField, record, SelectField, TextField } from "./spec-fields";

const CREDENTIALS = [
  { value: "member", label: "Each admin's own Google connection" },
  { value: "org", label: "An org Google connection" },
];

const RUNGS = [
  { value: "0", label: "0: rule or template, no AI" },
  { value: "3", label: "3: triggered draft for review" },
  { value: "4", label: "4: on its own, reversible internal actions only" },
];

export function SpecSettings({
  draft,
  issues,
  onChange,
}: {
  draft: SpecDraft;
  /** The issues about the spec's settings, not its steps. */
  issues: readonly SpecIssue[];
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const invalid = (...path: (string | number)[]) => issuesAt(issues, ...path).length > 0;
  const trigger = record(draft.trigger);
  const autonomy = record(draft.autonomy);
  const budget = record(draft.budget);
  return (
    <section aria-label="Settings" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Settings</h3>
      <TextField
        label="Spec ID"
        value={draft.id}
        invalid={invalid("id")}
        onChange={(id) => {
          onChange({ id });
        }}
      />
      <SelectField
        label="Credentials"
        value={draft.credentials}
        options={CREDENTIALS}
        invalid={invalid("credentials")}
        onChange={(credentials) => {
          onChange({ credentials });
        }}
      />
      <ListField
        label="Trigger: new Gmail messages with any of these labels (comma-separated)"
        value={trigger.labelIds ?? ["INBOX"]}
        invalid={invalid("trigger")}
        onChange={(labelIds) => {
          onChange({ trigger: { ...trigger, type: "gmail.message_received", labelIds } });
        }}
      />
      <SelectField
        label="Rung"
        value={autonomy.rung}
        options={RUNGS}
        invalid={invalid("autonomy")}
        onChange={(rung) => {
          onChange({ autonomy: { ...autonomy, rung: Number(rung) } });
        }}
      />
      <NumberField
        label="Monthly credit budget (optional)"
        value={budget.monthlyCredits}
        min={1}
        step={1}
        invalid={invalid("budget")}
        onChange={(monthlyCredits) => {
          onChange({ budget: monthlyCredits === undefined ? undefined : { monthlyCredits } });
        }}
      />
    </section>
  );
}
