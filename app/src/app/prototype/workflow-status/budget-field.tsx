"use client";

// PROTOTYPE, throwaway: the budget field with M7's help text. Every variant uses the same field
// (where it sits is the question, not how it looks). Saving only updates local state.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkflowStatus } from "./use-workflow-status";

/** What the budget does, in the words the field shows under it. */
export const BUDGET_HELP = [
  "The most this workflow may spend in a calendar month, counted in UTC from the 1st. Only its live runs count; Try it and builder chats don't.",
  "Once it's spent, the workflow pauses until next month. Raising or removing the budget resumes it at once. Leave it empty to let only the company's balance limit it.",
];

export function BudgetField({
  status,
  compact = false,
  id = "budget",
}: {
  status: WorkflowStatus;
  /** Narrow columns stack the buttons and shorten the help. */
  compact?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState(status.budget === null ? "" : String(status.budget));
  const parsed = draft.trim() === "" ? null : Number(draft);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 1);
  const unchanged = parsed === status.budget;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) status.saveBudget(parsed);
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Monthly credit budget (optional)
      </label>
      <div className={cn("flex gap-2", compact && "flex-wrap")}>
        <Input
          id={id}
          inputMode="numeric"
          value={draft}
          placeholder="No budget"
          aria-invalid={invalid}
          aria-describedby={`${id}-help`}
          className="w-32 tabular-nums"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" variant="outline" disabled={invalid || unchanged}>
          Save budget
        </Button>
        {status.budget === null ? null : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft("");
              status.saveBudget(null);
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <div id={`${id}-help`} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {invalid ? <p className="text-destructive">Enter a whole number of credits.</p> : null}
        {(compact ? BUDGET_HELP.slice(1) : BUDGET_HELP).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {compact ? <p>Counts live runs only, this calendar month (UTC).</p> : null}
      </div>
    </form>
  );
}
