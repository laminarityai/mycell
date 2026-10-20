import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus } from "../types";

/**
 * Where a connection's ingest stands, with its backfills' progress when it's known: "Backfilling,
 * 120 items so far", then "Active", "Needs reconnecting", or "Backfill failed".
 */
export function StatusBadge({
  status,
  backfilledItems,
}: {
  status: ConnectionStatus;
  backfilledItems?: number;
}) {
  if (status === "failed") return <Badge variant="destructive">Backfill failed</Badge>;
  if (status === "needs_reauth") return <Badge variant="destructive">Needs reconnecting</Badge>;
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  return (
    <Badge variant="outline">
      {backfilledItems === undefined
        ? "Backfilling…"
        : `Backfilling, ${String(backfilledItems)} ${backfilledItems === 1 ? "item" : "items"} so far`}
    </Badge>
  );
}

/** When polling last finished for a connection, or that it hasn't yet. */
export function LastPolled({ at }: { at: Date | null }) {
  if (at === null) return <span className="text-muted-foreground">Not yet</span>;
  return (
    <time dateTime={at.toISOString()} title={at.toISOString()}>
      {at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
    </time>
  );
}
