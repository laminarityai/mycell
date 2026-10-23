// The latest ledger entries, with what an admin checks a surprising charge by: what it was,
// its workflow, role, model and credits. Grants show their note; failed calls are marked.
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
import { formatSigned, SPENDING_KIND_LABELS } from "../format";
import { type LedgerLine, spendingKindOf } from "../types";

export function LedgerTable({ entries }: { entries: LedgerLine[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No entries yet.</p>;
  }
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
              <DateTime value={entry.createdAt} />
            </TableCell>
            <TableCell>
              <EntryLabel entry={entry} />
            </TableCell>
            <TableCell>{entry.workflowName ?? ""}</TableCell>
            <TableCell>{entry.role ?? ""}</TableCell>
            <TableCell className="font-mono text-xs">{entry.modelId ?? ""}</TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                entry.kind === "grant" && "font-semibold text-emerald-700 dark:text-emerald-400",
              )}
            >
              {formatSigned(entry.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EntryLabel({ entry }: { entry: LedgerLine }) {
  if (entry.kind === "grant") {
    return (
      <span className="flex flex-col gap-0.5">
        <span>Grant</span>
        {entry.note === null ? null : (
          <span className="text-xs text-muted-foreground">{entry.note}</span>
        )}
      </span>
    );
  }
  const kind = spendingKindOf(entry);
  return (
    <span className="flex flex-wrap items-center gap-2">
      Usage
      {kind === null ? null : (
        <span className="text-muted-foreground">{SPENDING_KIND_LABELS[kind]}</span>
      )}
      {entry.outcome === "failed" ? <Badge variant="destructive">Failed call</Badge> : null}
    </span>
  );
}
