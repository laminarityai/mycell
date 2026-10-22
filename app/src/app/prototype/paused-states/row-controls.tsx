// PROTOTYPE, throwaway: the controls a switch row offers, stubbed on local state: a member's
// switch (or Re-enable and Switch off while it needs their OK), an admin's org switch, and an
// admin's fix for a pause (resume, raise the budget, see credits).
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PausedReason } from "../_shared/fixtures";
import type { PauseRow } from "./paused-fixtures";
import type { PausedRows } from "./use-paused-rows";

/** The person's switch: Re-enable and Switch off while it needs their OK, a switch otherwise. */
export function SwitchControl({
  row,
  rows,
  admin,
}: {
  row: PauseRow;
  rows: PausedRows;
  admin: boolean;
}) {
  // A member reads a shared-inbox switch; only an admin changes it.
  if (row.kind === "org" && !admin) return null;
  if (row.reasons.includes("needs_reenable")) {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            rows.lift(row.id, "needs_reenable");
          }}
        >
          Re-enable
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            rows.setOn(row.id, false);
          }}
        >
          Switch off
        </Button>
      </div>
    );
  }
  return (
    <Switch
      checked={row.on}
      aria-label={row.name}
      onCheckedChange={(checked) => {
        rows.setOn(row.id, checked);
      }}
    />
  );
}

/** What an admin can do about one pause, if anything. */
export function AdminFix({
  row,
  reason,
  rows,
}: {
  row: PauseRow;
  reason: PausedReason;
  rows: PausedRows;
}) {
  if (reason === "out_of_credits") {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href="/prototype/credits">See credits</Link>
      </Button>
    );
  }
  if (reason === "failures") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            rows.lift(row.id, "failures");
          }}
        >
          Resume
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href="/prototype/runs">See the 3 failed runs</Link>
        </Button>
      </div>
    );
  }
  if (reason === "budget_reached") {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          rows.lift(row.id, "budget_reached");
        }}
      >
        Raise budget
      </Button>
    );
  }
  return null;
}
