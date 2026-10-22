// PROTOTYPE, throwaway: variant C's body: one table with a Status column and a Since column,
// and under every paused row a timeline of when each pause began and what lifts it, in order.
"use client";

import { Fragment } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { alsoNeedsOk, keepsSwitch, liftText, runningText } from "./pause-copy";
import { type PauseRow, pausedLabel } from "./paused-fixtures";
import { PauseTimeline, sinceText } from "./pause-timeline";
import { AdminFix, SwitchControl } from "./row-controls";
import { type PausedRows, usePausedRows } from "./use-paused-rows";

export function StatusTable({ admin, creditsOut }: { admin: boolean; creditsOut: boolean }) {
  const rows = usePausedRows(admin, creditsOut);
  const all = [...rows.mine, ...rows.org];
  const columns = admin ? 6 : 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workflow</TableHead>
          {admin ? <TableHead>Runs on</TableHead> : null}
          <TableHead>Status</TableHead>
          <TableHead>Since</TableHead>
          <TableHead className="w-[34%]">What lifts it</TableHead>
          <TableHead className="text-right">Switch</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {all.map((row) => (
          <Fragment key={row.id}>
            <Row row={row} rows={rows} admin={admin} />
            {row.reasons.length === 0 ? null : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns} className="bg-muted/30 px-4 pt-3 pb-4">
                  <PauseTimeline row={row} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function Row({ row, rows, admin }: { row: PauseRow; rows: PausedRows; admin: boolean }) {
  const shown = row.reasons.at(0);
  return (
    <TableRow className={cn(shown !== undefined && "border-b-0")}>
      <TableCell className="align-top">
        <span className="font-medium">{row.name}</span>
        <p className="text-xs text-muted-foreground">{row.apps.join(", ")}</p>
      </TableCell>
      {admin ? (
        <TableCell className="align-top text-muted-foreground">
          {row.kind === "org" ? "Shared inbox" : "Your Google account"}
        </TableCell>
      ) : null}
      <TableCell className="align-top">
        {shown === undefined ? (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                row.on ? "bg-emerald-600" : "bg-muted-foreground/40",
              )}
            />
            {runningText(row)}
          </span>
        ) : (
          <span className="flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-destructive" />
            {pausedLabel(shown)}
          </span>
        )}
      </TableCell>
      <TableCell className="align-top">{shown === undefined ? null : sinceText(row)}</TableCell>
      <TableCell className="align-top text-sm whitespace-normal">
        {shown === undefined ? null : (
          <div className="flex flex-col items-start gap-2">
            <span>
              {liftText(shown, admin)}
              {keepsSwitch(shown) && row.kind === "member" ? " Your switch stays on." : ""}
            </span>
            {alsoNeedsOk(row) === null ? null : (
              <span className="font-medium">{alsoNeedsOk(row)}</span>
            )}
            {admin ? <AdminFix row={row} reason={shown} rows={rows} /> : null}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right align-top">
        <div className="flex justify-end">
          <SwitchControl row={row} rows={rows} admin={admin} />
        </div>
      </TableCell>
    </TableRow>
  );
}
