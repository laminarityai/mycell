"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  addExclusionAction,
  removeExclusionAction,
  setMemoryBudgetAction,
  startMemoryAction,
} from "../actions";
import { EXCLUSION_KIND_NAMES, EXCLUSION_KINDS } from "../types";

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
        <Input
          id="monthly-budget"
          name="monthlyBudget"
          type="number"
          min="1"
          step="any"
          required
          defaultValue={budget}
          className="w-32"
        />
        <Button type="submit" size="sm" disabled={submitting}>
          {started ? "Save budget" : "Start memory"}
        </Button>
      </div>
      <FormError message={result.error} />
    </form>
  );
}

export function AddExclusionForm() {
  const [result, add, adding] = useActionState(addExclusionAction, {});
  return (
    <form action={add} className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <NativeSelect name="kind" aria-label="What to exclude">
          {EXCLUSION_KINDS.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {EXCLUSION_KIND_NAMES[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          name="value"
          required
          maxLength={320}
          placeholder="HR, firm.example, a folder link…"
          aria-label="Label, address, domain or folder"
          className="w-64"
        />
        <Button type="submit" size="sm" disabled={adding}>
          Exclude
        </Button>
      </div>
      <FormError message={result.error} />
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
      <FormError message={result.error} />
    </form>
  );
}
