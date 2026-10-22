// PROTOTYPE, throwaway: variant A2's list. Variant A's cards, with the apps each workflow uses
// as small marks in the card's corner (names on hover), an org switch's shared inbox among
// them, and the app named with its mark in a notice when the pause comes from that app.
"use client";

import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PausedReason } from "../_shared/fixtures";
import { AppIcon, AppMark, appKey, type AppKey } from "../_shared/app-icons";
import { keepsSwitch, liftText, runningText, whyText } from "./pause-copy";
import { type PauseRow, pausedLabel } from "./paused-fixtures";
import { AdminFix, SwitchControl } from "./row-controls";
import { type PausedRows, usePausedRows } from "./use-paused-rows";

/** The shared inbox each org switch runs on (the org connections in the shared fixtures). */
const SHARED_INBOX: Record<string, string | undefined> = {
  "wf-invoices": "invoices@fernhill.co",
  "wf-status": "orders@fernhill.co",
  "wf-sort-orders": "orders@fernhill.co",
};

/** When a pause comes from one app, which app and what it did there. */
const FROM_APP: Partial<Record<string, { app: AppKey; text: string }>> = {
  "wf-chase:needs_reenable": {
    app: "gmail",
    text: "Version 4 sends the reminder from Gmail itself, where version 3 left a draft for you.",
  },
  "wf-followups:failures": {
    app: "tasks",
    text: "All 3 failed adding the follow-up to Google Tasks.",
  },
};

export function CardListA2({ admin, creditsOut }: { admin: boolean; creditsOut: boolean }) {
  const rows = usePausedRows(admin, creditsOut);
  return (
    <>
      <ul className="flex flex-col gap-4" aria-label="Workflows">
        {(admin ? rows.mine : [...rows.mine, ...rows.org]).map((row) => (
          <li key={row.id}>
            <WorkflowCardA2 row={row} rows={rows} admin={admin} />
          </li>
        ))}
      </ul>
      {admin ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Shared inbox switches</h2>
          <ul className="flex flex-col gap-4" aria-label="Shared inbox switches">
            {rows.org.map((row) => (
              <li key={row.id}>
                <WorkflowCardA2 row={row} rows={rows} admin={admin} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function AppsUsed({ row }: { row: PauseRow }) {
  const inbox = row.kind === "org" ? SHARED_INBOX[row.id] : undefined;
  const apps = row.apps.flatMap((label) => {
    const key = appKey(label);
    return key === undefined ? [] : [key];
  });
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Apps it uses">
      {apps.map((app) => (
        <AppMark key={app} app={app} />
      ))}
      {inbox === undefined ? null : (
        <span
          role="img"
          aria-label={`Shared inbox ${inbox}`}
          className="group/app relative ml-1 inline-flex items-center gap-1.5 rounded-md border bg-background py-1 pr-2 pl-1.5 text-xs text-muted-foreground"
        >
          <Inbox className="size-3.5" aria-hidden />
          {inbox.split("@")[0]}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-hover/app:opacity-100"
          >
            Shared inbox {inbox}
          </span>
        </span>
      )}
    </div>
  );
}

function WorkflowCardA2({ row, rows, admin }: { row: PauseRow; rows: PausedRows; admin: boolean }) {
  const shown = row.reasons.at(0);
  return (
    <Card aria-label={row.name}>
      <CardHeader>
        <CardTitle>{row.name}</CardTitle>
        <CardDescription>
          {row.kind === "org"
            ? `Runs on the shared inbox ${SHARED_INBOX[row.id] ?? ""}, managed by admins.`
            : "Runs on your own Google account."}
        </CardDescription>
        <CardAction>
          <AppsUsed row={row} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div>
          {shown === undefined ? (
            <Badge variant={row.on ? "outline" : "secondary"}>{runningText(row)}</Badge>
          ) : (
            <Badge variant={shown === "needs_reenable" ? "default" : "secondary"}>
              {pausedLabel(shown)}
            </Badge>
          )}
        </div>
        {shown === undefined ? null : <Notice row={row} reason={shown} rows={rows} admin={admin} />}
        <SwitchControl row={row} rows={rows} admin={admin} />
      </CardContent>
    </Card>
  );
}

function Notice({
  row,
  reason,
  rows,
  admin,
}: {
  row: PauseRow;
  reason: PausedReason;
  rows: PausedRows;
  admin: boolean;
}) {
  const fromApp = FROM_APP[`${row.id}:${reason}`];
  return (
    <div
      role="group"
      aria-label="Why it's paused"
      className="flex flex-col gap-2 rounded-md border-l-2 border-foreground/20 bg-muted/50 px-3 py-2.5"
    >
      <p>{whyText(row, reason)}</p>
      {fromApp === undefined ? null : (
        <p className="flex items-start gap-2">
          <AppIcon app={fromApp.app} size={16} className="mt-0.5" />
          <span>{fromApp.text}</span>
        </p>
      )}
      <p className="text-muted-foreground">
        {liftText(reason, admin)}
        {keepsSwitch(reason) && row.kind === "member" ? " Your switch stays on." : ""}
      </p>
      {row.reasons.slice(1).map((next) => (
        <p key={next} className="text-muted-foreground">
          Once that lifts it will still be{" "}
          <span className="font-medium text-foreground">{pausedLabel(next)}</span>
          {next === "needs_reenable" ? " until you switch it on again." : "."}
        </p>
      ))}
      {admin ? <AdminFix row={row} reason={reason} rows={rows} /> : null}
    </div>
  );
}
