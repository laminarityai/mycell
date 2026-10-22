// PROTOTYPE, throwaway: variant B's body: one banner grouping every pause by its reason (why,
// what lifts it, and the fix per workflow), then a quiet list where a paused row only dims.
"use client";

import { Fragment } from "react";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PAUSED_TEXT, type PausedReason } from "../_shared/fixtures";
import { liftText, runningText } from "./pause-copy";
import { ORDER, type PauseRow, pausedLabel } from "./paused-fixtures";
import { AdminFix } from "./row-controls";
import { type PausedRows, usePausedRows } from "./use-paused-rows";

const NUMBER = new Intl.NumberFormat("en-US");

const GROUP_WHY: Record<PausedReason, string> = {
  out_of_credits: "Your company has run out of credits, so no workflow starts new runs.",
  failures: "The last 3 runs failed in a row, so Mycel stopped it before it failed again.",
  budget_reached: "It has spent its credit budget for this month.",
  needs_reenable: "An admin published a riskier version. It waits for your OK.",
};

export function BannerList({ admin, creditsOut }: { admin: boolean; creditsOut: boolean }) {
  const rows = usePausedRows(admin, creditsOut);
  const all = [...rows.mine, ...rows.org];
  const paused = all.filter((row) => row.reasons.length > 0);
  return (
    <>
      {paused.length === 0 ? null : <PauseBanner paused={paused} rows={rows} admin={admin} />}
      <QuietList
        groups={
          admin
            ? [
                ["Your Google account", rows.mine],
                ["Shared inboxes", rows.org],
              ]
            : [["", all]]
        }
        rows={rows}
        admin={admin}
      />
    </>
  );
}

function PauseBanner({
  paused,
  rows,
  admin,
}: {
  paused: PauseRow[];
  rows: PausedRows;
  admin: boolean;
}) {
  const groups = ORDER.map((reason) => ({
    reason,
    items: paused.filter((row) => row.reasons[0] === reason),
  })).filter((group) => group.items.length > 0);
  const count = paused.length;
  return (
    <section
      aria-label="What's paused"
      className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-5 text-sm"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <PauseCircle className="size-5" aria-hidden />
        {count === 1 ? "1 workflow is paused" : `${String(count)} workflows are paused`}
      </h2>
      {groups.map(({ reason, items }) => (
        <div key={reason} className="flex flex-col gap-1.5 border-t pt-3">
          <p className="font-medium">{pausedLabel(reason)}</p>
          <p className="text-muted-foreground">
            {GROUP_WHY[reason]} {liftText(reason, admin)}
            {reason === "needs_reenable" ? "" : " Switches stay as they are."}
          </p>
          <ul className="mt-1 flex flex-col gap-2">
            {items.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{row.name}</span>
                {reason === "budget_reached" && row.budget !== undefined ? (
                  <span className="text-muted-foreground">
                    {NUMBER.format(row.budget.spent)} of {NUMBER.format(row.budget.limit)} credits
                  </span>
                ) : null}
                {reason === "needs_reenable" && row.riskRaised !== undefined ? (
                  <span className="text-muted-foreground">
                    Risk went up from {row.riskRaised.from} to {row.riskRaised.to}
                  </span>
                ) : null}
                {row.reasons.length > 1 ? (
                  <span className="text-muted-foreground">
                    then still paused: {PAUSED_TEXT[row.reasons[1]]}
                  </span>
                ) : null}
                <span className="ml-auto">
                  {row.reasons.includes("needs_reenable") ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        rows.lift(row.id, "needs_reenable");
                      }}
                    >
                      Re-enable
                    </Button>
                  ) : admin && reason !== "out_of_credits" ? (
                    <AdminFix row={row} reason={reason} rows={rows} />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {admin && reason === "out_of_credits" ? (
            <div>
              <AdminFix row={items[0]} reason={reason} rows={rows} />
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function QuietList({
  groups,
  rows,
  admin,
}: {
  groups: [string, PauseRow[]][];
  rows: PausedRows;
  admin: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border" aria-label="Workflows">
      {groups.map(([label, items]) => (
        <Fragment key={label}>
          {label === "" ? null : (
            <li className="bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
              {label}
            </li>
          )}
          {items.map((row) => {
            const paused = row.reasons.length > 0;
            const needsOk = row.reasons.includes("needs_reenable");
            const canSwitch = row.kind === "member" || admin;
            return (
              <li key={row.id} className="flex items-center gap-4 px-4 py-3 text-sm">
                <div className={cn("flex min-w-0 flex-1 flex-col", paused && "opacity-60")}>
                  <span className="font-medium">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.apps.join(", ")}
                    {row.kind === "org" && !admin ? ", on a shared inbox" : ""}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {paused ? "Paused" : runningText(row)}
                </span>
                {canSwitch ? (
                  <Switch
                    aria-label={row.name}
                    checked={row.on && !needsOk}
                    onCheckedChange={(checked) => {
                      if (checked && needsOk) rows.lift(row.id, "needs_reenable");
                      else rows.setOn(row.id, checked);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}
