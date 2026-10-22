// PROTOTYPE, throwaway: variant B's Ledger tab, a plain table of the latest entries with the
// columns an admin checks a surprising charge by: what, workflow, role, model, credits.
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LEDGER, workflowById, type LedgerEntry } from "../_shared/fixtures";
import { signed } from "./format";

const KIND: Record<LedgerEntry["kind"], string> = {
  grant: "Grant",
  usage: "Usage",
  correction: "Correction",
};

const PURPOSE: Record<NonNullable<LedgerEntry["purpose"]>, string> = {
  run: "Run",
  try_it: "Try it",
  builder: "Builder chat",
  memory: "Memory",
  agent: "Ask Mycel",
  injection_screen: "Mail screening",
};

/** The latest entries, or the ones given (variant E2 passes a range's). */
export function LedgerTable({ entries = LEDGER }: { entries?: LedgerEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Entry</TableHead>
          <TableHead>Workflow</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Credits</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id} className={cn(entry.kind === "grant" && "bg-muted/40")}>
            <TableCell className="text-muted-foreground">
              <DateTime value={entry.at} />
            </TableCell>
            <TableCell>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  {KIND[entry.kind]}
                  {entry.purpose ? (
                    <span className="text-muted-foreground">{PURPOSE[entry.purpose]}</span>
                  ) : null}
                  {entry.failed ? <Badge variant="destructive">Failed call</Badge> : null}
                </span>
                {entry.note ? (
                  <span className="text-xs text-muted-foreground">{entry.note}</span>
                ) : null}
              </span>
            </TableCell>
            <TableCell>
              {entry.workflowId ? (workflowById(entry.workflowId)?.name ?? "") : ""}
            </TableCell>
            <TableCell>{entry.role ?? ""}</TableCell>
            <TableCell className="font-mono text-xs">{entry.model ?? ""}</TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                entry.kind === "grant" && "font-semibold text-emerald-700 dark:text-emerald-400",
              )}
            >
              {signed(entry.credits)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
