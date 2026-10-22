"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { grantStaffConsentAction, revokeStaffConsentAction } from "../actions";
import { MAX_STAFF_CONSENT_DAYS } from "../types";

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** An admin names a person at Mycel, the case, and how many days they may read memory for. */
export function GrantStaffConsentForm() {
  const [result, grant, granting] = useActionState(grantStaffConsentAction, {});
  return (
    <form action={grant} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Mycel staff email
          <input
            name="staffEmail"
            type="email"
            required
            maxLength={320}
            placeholder="name@mycel.ai"
            className={fieldClass}
          />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          The case
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="Support ticket 4411: a wrong fact about a customer"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Days
          <input
            name="days"
            type="number"
            required
            min={1}
            max={MAX_STAFF_CONSENT_DAYS}
            defaultValue={7}
            className={`${fieldClass} w-20`}
          />
        </label>
        <Button type="submit" size="sm" disabled={granting}>
          Give consent
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

/** Ends one consent at once. */
export function RevokeStaffConsentButton({ consentId }: { consentId: string }) {
  const [result, revoke, revoking] = useActionState(revokeStaffConsentAction, {});
  return (
    <form action={revoke} className="flex flex-col gap-1">
      <input type="hidden" name="consentId" value={consentId} />
      <Button type="submit" variant="outline" size="sm" disabled={revoking}>
        Revoke
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
