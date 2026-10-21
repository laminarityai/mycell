import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MailView } from "@/features/runtime/adapters";
import { ReviewActions } from "./lib/review-actions";
import type { OpenedReview, ReviewKind, ReviewStatus, ReviewSummary } from "./types";

const KIND_LABELS: Record<ReviewKind, string> = { approval: "Draft reply" };

const ENDINGS: Record<Exclude<ReviewStatus, "waiting">, string> = {
  approved: "It was approved and sent.",
  edited_approved: "It was edited, approved and sent.",
  declined: "It was declined, and its draft deleted.",
  done_in_app: "It was sent from Gmail.",
  gone: "Its draft is no longer in Gmail.",
};

/** The caller's waiting reviews, oldest first: each one's workflow, kind and age. */
export function ReviewsList({ reviews, now }: { reviews: ReviewSummary[]; now: Date }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing is waiting for you.</p>;
  }
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
        {reviews.map((review) => (
          <TableRow key={review.id}>
            <TableCell>
              <Link href={`/reviews/${review.id}`} className="font-medium hover:underline">
                {review.workflowName}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{KIND_LABELS[review.kind]}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{age(review.createdAt, now)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * An open review: the message and the drafted reply, fetched live, with approve, edit and
 * decline; or, once it has ended, how it ended.
 */
export function ReviewDetail({ opened, now }: { opened: OpenedReview; now: Date }) {
  const { review, view } = opened;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {review.workflowName} · {KIND_LABELS[review.kind]} · waiting {age(review.createdAt, now)}
      </p>
      {review.status !== "waiting" || view === null ? (
        <p>This review has ended. {review.status === "waiting" ? "" : ENDINGS[review.status]}</p>
      ) : (
        <>
          {view.message === null ? (
            <p className="text-sm text-muted-foreground">The message it replies to is gone.</p>
          ) : (
            <Mail title="The message" mail={view.message} who={`From ${view.message.from}`} />
          )}
          <Mail title="The drafted reply" mail={view.draft} who={`To ${view.draft.to}`} />
          <ReviewActions reviewId={review.id} draftText={view.draft.text} />
        </>
      )}
    </div>
  );
}

function Mail({ title, mail, who }: { title: string; mail: MailView; who: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {who} · {mail.subject}
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-sm whitespace-pre-wrap">{mail.text}</p>
      </CardContent>
    </Card>
  );
}

/** How long a review has waited, in its largest whole unit. */
function age(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}
