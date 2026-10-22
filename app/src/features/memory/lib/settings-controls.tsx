"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import {
  addExclusionAction,
  removeExclusionAction,
  setMemoryBudgetAction,
  startMemoryAction,
} from "../actions";
import { EXCLUSION_KIND_NAMES, EXCLUSION_KINDS } from "../types";

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The monthly budget, and the button that starts memory, or saves a new budget once started. */
export function BudgetForm({ started, budget }: { started: boolean; budget: number }) {
  const [result, submit, submitting] = useActionState(
    started ? setMemoryBudgetAction : startMemoryAction,
    {},
  );
  return (
    <form action={submit} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="monthly-budget" className="text-sm">
          Monthly budget (credits)
        </label>
        <input
          id="monthly-budget"
          name="monthlyBudget"
          type="number"
          min="1"
          step="any"
          required
          defaultValue={budget}
          className={`${fieldClass} w-32`}
        />
        <Button type="submit" size="sm" disabled={submitting}>
          {started ? "Save budget" : "Start memory"}
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

export function AddExclusionForm() {
  const [result, add, adding] = useActionState(addExclusionAction, {});
  return (
    <form action={add} className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <select name="kind" aria-label="What to exclude" className={fieldClass}>
          {EXCLUSION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EXCLUSION_KIND_NAMES[kind]}
            </option>
          ))}
        </select>
        <input
          name="value"
          required
          maxLength={320}
          placeholder="HR, firm.example, a folder link…"
          aria-label="Label, address, domain or folder"
          className={`${fieldClass} w-64`}
        />
        <Button type="submit" size="sm" disabled={adding}>
          Exclude
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

export function RemoveExclusionButton({ id, name }: { id: string; name: string }) {
  const [result, remove, removing] = useActionState(removeExclusionAction, {});
  return (
    <form action={remove} className="flex flex-col items-end gap-1">
      <input type="hidden" name="exclusionId" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={removing}
        aria-label={`Stop excluding ${name}`}
      >
        Remove
      </Button>
      <ErrorMessage result={result} />
    </form>
  );
}

function ErrorMessage({ result }: { result: ActionResult }) {
  return result.error === undefined ? null : (
    <p role="alert" className="text-sm text-destructive">
      {result.error}
    </p>
  );
}
