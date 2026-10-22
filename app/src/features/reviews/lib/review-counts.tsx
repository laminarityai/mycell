// Review counts as the Workflows page shows them (the ship bar's measurement): for each row (a
// workflow, or a person under it) how many reviews wait and how many ended each way, the share
// approved without edits, and the escalations and held sends apart. Counts only: nothing from
// anyone's mail.
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  reviewPeriods,
  type ReviewCounts,
  type ReviewCountsRow,
  type ReviewPeriod,
  type ReviewTally,
} from "../types";

const PERIOD_LABELS: Record<ReviewPeriod, string> = {
  "2d": "Last 2 days",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  current_version: "Since current version",
};

/**
 * The period picker (links to `basePath` with each period chosen), then the counts table.
 */
export function ReviewCountsSection({
  title,
  description,
  period,
  rows,
  basePath,
}: {
  title: string;
  description: string;
  period: ReviewPeriod;
  rows: ReviewCountsRow[];
  basePath: string;
}) {
  return (
    <section aria-labelledby="review-counts" className="flex flex-col gap-3">
      <h2 id="review-counts" className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <nav aria-label="Period" className="flex flex-wrap gap-3 text-sm">
        {reviewPeriods.map((choice) => (
          <Link
            key={choice}
            href={`${basePath}?period=${choice}`}
            aria-current={choice === period ? "page" : undefined}
            className={cn(
              "underline-offset-4 hover:underline",
              choice === period ? "font-medium" : "text-muted-foreground",
            )}
          >
            {PERIOD_LABELS[choice]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workflows to count yet.</p>
      ) : (
        <CountsTable rows={rows} />
      )}
    </section>
  );
}

function CountsTable({ rows }: { rows: ReviewCountsRow[] }) {
  return (
    <Table aria-label="Review counts">
      <TableHeader>
        <TableRow>
          <TableHead>Workflow</TableHead>
          <TableHead>Waiting</TableHead>
          <TableHead>Approved</TableHead>
          <TableHead>Edited and approved</TableHead>
          <TableHead>Declined</TableHead>
          <TableHead>Sent from Gmail</TableHead>
          <TableHead>Gone</TableHead>
          <TableHead>Approved without edits</TableHead>
          <TableHead>Escalations</TableHead>
          <TableHead>Held sends</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const drafts = row.tally.approvals;
          return (
            <TableRow key={row.key}>
              <TableCell
                className={row.person === true ? "pl-6 text-muted-foreground" : "font-medium"}
              >
                {row.label}
              </TableCell>
              <TableCell>{waiting(row.tally)}</TableCell>
              <TableCell>{drafts.approved}</TableCell>
              <TableCell>{drafts.edited_approved}</TableCell>
              <TableCell>{drafts.declined}</TableCell>
              <TableCell>{drafts.done_in_app}</TableCell>
              <TableCell>{drafts.gone}</TableCell>
              <TableCell>{share(row.tally.approvedWithoutEdits)}</TableCell>
              <TableCell className="whitespace-normal">
                {escalations(row.tally.escalations)}
              </TableCell>
              <TableCell className="whitespace-normal">{heldSends(row.tally.heldSends)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// Drafts, escalated messages and held sends still waiting.
function waiting(tally: ReviewTally): number {
  return tally.approvals.waiting + tally.escalations.waiting + tally.heldSends.waiting;
}

function share(value: number | null): string {
  return value === null ? "—" : `${String(Math.round(value * 100))}%`;
}

// An escalation ends done (in Mycel, or by a reply in Gmail) or with its message gone.
function escalations(counts: ReviewCounts): string {
  const parts = [
    counts.done_in_app > 0 ? `${String(counts.done_in_app)} done` : null,
    counts.gone > 0 ? `${String(counts.gone)} gone` : null,
    counts.waiting > 0 ? `${String(counts.waiting)} waiting` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "None" : parts.join(", ");
}

// A held send ends approved (as it was, or edited), declined, expired after 30 days, or gone.
function heldSends(counts: ReviewCounts): string {
  const parts = [
    counts.approved > 0 ? `${String(counts.approved)} approved` : null,
    counts.edited_approved > 0 ? `${String(counts.edited_approved)} edited` : null,
    counts.declined > 0 ? `${String(counts.declined)} declined` : null,
    counts.expired > 0 ? `${String(counts.expired)} expired` : null,
    counts.gone > 0 ? `${String(counts.gone)} gone` : null,
    counts.waiting > 0 ? `${String(counts.waiting)} waiting` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "None" : parts.join(", ");
}
