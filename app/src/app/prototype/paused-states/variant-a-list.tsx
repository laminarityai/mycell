// PROTOTYPE, throwaway: variant A's list, today's pattern extended: each workflow is its own card with
// a "Paused: …" badge, and under it a notice saying why, what lifts it, and what still holds
// once it lifts. An admin's view adds a second list of shared-inbox switches.
"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { keepsSwitch, liftText, runningText, whyText } from "./pause-copy";
import { type PauseRow, pausedLabel } from "./paused-fixtures";
import { AdminFix, SwitchControl } from "./row-controls";
import { type PausedRows, usePausedRows } from "./use-paused-rows";

export function CardList({ admin, creditsOut }: { admin: boolean; creditsOut: boolean }) {
  const rows = usePausedRows(admin, creditsOut);
  return (
    <>
      <ul className="flex flex-col gap-4" aria-label="Workflows">
        {(admin ? rows.mine : [...rows.mine, ...rows.org]).map((row) => (
          <li key={row.id}>
            <WorkflowCard row={row} rows={rows} admin={admin} />
          </li>
        ))}
      </ul>
      {admin ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Shared inbox switches</h2>
          <ul className="flex flex-col gap-4" aria-label="Shared inbox switches">
            {rows.org.map((row) => (
              <li key={row.id}>
                <WorkflowCard row={row} rows={rows} admin={admin} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function WorkflowCard({ row, rows, admin }: { row: PauseRow; rows: PausedRows; admin: boolean }) {
  const shown = row.reasons.at(0);
  return (
    <Card aria-label={row.name}>
      <CardHeader>
        <CardTitle>{row.name}</CardTitle>
        <CardDescription>
          {row.kind === "org"
            ? "Runs on a shared inbox, managed by admins."
            : "Runs on your own Google account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Needs</dt>
          <dd>{row.apps.join(", ")}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {shown === undefined ? (
              <Badge variant={row.on ? "outline" : "secondary"}>{runningText(row)}</Badge>
            ) : (
              <Badge variant={shown === "needs_reenable" ? "default" : "secondary"}>
                {pausedLabel(shown)}
              </Badge>
            )}
          </dd>
        </dl>
        {shown === undefined ? null : (
          <div
            role="group"
            aria-label="Why it's paused"
            className="flex flex-col gap-2 rounded-md border-l-2 border-foreground/20 bg-muted/50 px-3 py-2.5"
          >
            <p>{whyText(row, shown)}</p>
            <p className="text-muted-foreground">
              {liftText(shown, admin)}
              {keepsSwitch(shown) && row.kind === "member" ? " Your switch stays on." : ""}
            </p>
            {row.reasons.slice(1).map((next) => (
              <p key={next} className="text-muted-foreground">
                Once that lifts it will still be{" "}
                <span className="font-medium text-foreground">{pausedLabel(next)}</span>
                {next === "needs_reenable" ? " until you switch it on again." : "."}
              </p>
            ))}
            {admin ? <AdminFix row={row} reason={shown} rows={rows} /> : null}
          </div>
        )}
        <SwitchControl row={row} rows={rows} admin={admin} />
      </CardContent>
    </Card>
  );
}
