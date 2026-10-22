"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  forgetPersonAction,
  markCompanyWideListAction,
  setRetentionWindowAction,
  unmarkCompanyWideListAction,
  type ForgetResult,
} from "../actions";
import { MAX_RETENTION_MONTHS } from "../types";
import { ErrorMessage, fieldClass } from "./settings-controls";

/** The retention window, in months. */
export function RetentionForm({ months }: { months: number }) {
  const [result, save, saving] = useActionState(setRetentionWindowAction, {});
  return (
    <form action={save} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="retention-months" className="text-sm">
          Keep for (months)
        </label>
        <input
          id="retention-months"
          name="months"
          type="number"
          min="1"
          max={MAX_RETENTION_MONTHS}
          step="1"
          required
          defaultValue={months}
          className={`${fieldClass} w-20`}
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save window
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

/** A group address to mark company-wide. */
export function MarkCompanyWideListForm({ domain }: { domain: string }) {
  const [result, mark, marking] = useActionState(markCompanyWideListAction, {});
  return (
    <form action={mark} className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <input
          name="address"
          type="email"
          required
          maxLength={320}
          placeholder={`all@${domain}`}
          aria-label="Group address"
          className={`${fieldClass} w-64`}
        />
        <Button type="submit" size="sm" disabled={marking}>
          Mark company-wide
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

export function UnmarkCompanyWideListButton({ address }: { address: string }) {
  const [result, unmark, unmarking] = useActionState(unmarkCompanyWideListAction, {});
  return (
    <form action={unmark} className="flex flex-col items-end gap-1">
      <input type="hidden" name="address" value={address} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={unmarking}
        aria-label={`Stop treating ${address} as company-wide`}
      >
        Remove
      </Button>
      <ErrorMessage result={result} />
    </form>
  );
}

/** An email address to forget; afterwards, only how many facts went. */
export function ForgetPersonForm() {
  const [result, forget, forgetting] = useActionState<ForgetResult, FormData>(
    forgetPersonAction,
    {},
  );
  return (
    <form action={forget} className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          maxLength={320}
          placeholder="name@example.com"
          aria-label="Email address of the person to forget"
          className={`${fieldClass} w-64`}
        />
        <Button type="submit" size="sm" variant="destructive" disabled={forgetting}>
          Forget this person
        </Button>
      </div>
      {result.facts === undefined ? null : (
        <p role="status" className="text-sm">
          Done. Memory deleted {String(result.facts)} {result.facts === 1 ? "fact" : "facts"} and
          won&apos;t learn about them again.
        </p>
      )}
      <ErrorMessage result={result} />
    </form>
  );
}
