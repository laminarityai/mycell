// PROTOTYPE, throwaway: what every shell variant shows under its navigation: the out-of-credits
// banner (admins, M8 story 41) and a short Reviews page body, so density is judged in context.
import Link from "next/link";
import { CircleAlert } from "lucide-react";
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
import { NOW } from "../_shared/fixtures";

/** Credits are out: every workflow is paused. Granting lifts it by itself. */
export function OutOfCreditsBanner({ className }: { className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive",
        className,
      )}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <p className="flex-1">
        <span className="font-medium">Your company is out of credits.</span> Every workflow is
        paused and no runs start. They resume by themselves once the Mycel team grants more.
      </p>
      <Link href="/prototype/credits" className="font-medium underline underline-offset-4">
        See credits
      </Link>
    </div>
  );
}

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const SAMPLE = [
  { workflow: "Reply to quote requests", kind: "Draft reply", at: hoursAgo(0.4), note: null },
  {
    workflow: "Book customer calls",
    kind: "Calendar event",
    at: hoursAgo(2),
    note: "Handed to you by Tom Becker",
  },
  {
    workflow: "Label supplier invoices",
    kind: "Escalated message",
    at: hoursAgo(5),
    note: "Shared with Finance",
  },
  { workflow: "Reply to quote requests", kind: "Draft reply", at: hoursAgo(20), note: null },
  { workflow: "Weekly status into the ops doc", kind: "Doc edits", at: hoursAgo(30), note: null },
];

function age(at: Date) {
  const hours = Math.floor((NOW.getTime() - at.getTime()) / 3_600_000);
  if (hours < 1) return "25 minutes";
  if (hours < 24) return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
  return "1 day";
}

/** A short Reviews list, as the landing page shows it today. */
export function ReviewsSample() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workflow</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Waiting</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {SAMPLE.map((review, i) => (
          <TableRow key={i}>
            <TableCell>
              <span className="font-medium">{review.workflow}</span>
              {review.note === null ? null : (
                <p className="text-xs text-muted-foreground">{review.note}</p>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{review.kind}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{age(review.at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A nav count: Reviews waiting (default) or Alerts open (destructive). */
export function NavCount({
  value,
  tone,
  label,
}: {
  value: number;
  tone: "default" | "destructive";
  label: string;
}) {
  return (
    <Badge variant={tone}>
      {value}
      <span className="sr-only"> {label}</span>
    </Badge>
  );
}
