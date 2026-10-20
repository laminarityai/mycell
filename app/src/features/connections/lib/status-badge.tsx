import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus } from "../types";

/**
 * Where a connection's ingest stands, with the backfill's progress when it's known: "Backfilling,
 * 120 messages so far", then "Active", or "Backfill failed".
 */
export function StatusBadge({
  status,
  backfilledItems,
}: {
  status: ConnectionStatus;
  backfilledItems?: number;
}) {
  if (status === "failed") return <Badge variant="destructive">Backfill failed</Badge>;
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  return (
    <Badge variant="outline">
      {backfilledItems === undefined
        ? "Backfilling…"
        : `Backfilling, ${String(backfilledItems)} ${backfilledItems === 1 ? "message" : "messages"} so far`}
    </Badge>
  );
}
