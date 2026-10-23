"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { grantStaffConsentAction, revokeStaffConsentAction } from "../actions";
import { MAX_STAFF_CONSENT_DAYS } from "../types";

/** An admin names a person at Mycel, the case, and how many days they may read memory for. */
export function GrantStaffConsentForm() {
  const [result, grant, granting] = useActionState(grantStaffConsentAction, {});
  return (
    <form action={grant} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Mycel staff email
          <Input
            name="staffEmail"
            type="email"
            required
            maxLength={320}
            placeholder="name@mycel.ai"
            className="w-56"
          />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          The case
          <Input
            name="reason"
            required
            maxLength={500}
            placeholder="Support ticket 4411: a wrong fact about a customer"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Days
          <Input
            name="days"
            type="number"
            required
            min={1}
            max={MAX_STAFF_CONSENT_DAYS}
            defaultValue={7}
            className="w-20"
          />
        </label>
        <Button type="submit" size="sm" disabled={granting}>
          Give consent
        </Button>
      </div>
      <FormError message={result.error} />
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
      <FormError message={result.error} />
    </form>
  );
}
