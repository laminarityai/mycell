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
import type { ItemView, MailView } from "@/features/runtime/adapters";
import {
  EscalationActions,
  HandOffForm,
  HeldSendActions,
  ReviewActions,
} from "./lib/review-actions";
import type {
  HandOff,
  OpenedReview,
  Review,
  ReviewKind,
  ReviewStatus,
  ReviewSummary,
} from "./types";

export { ReviewCountsSection } from "./lib/review-counts";

const KIND_LABELS: Record<ReviewKind, string> = {
  approval: "Draft reply",
  escalation: "Escalated message",
  held_send: "Held send",
};

const ENDINGS: Record<Exclude<ReviewStatus, "waiting">, string> = {
  approved: "It was approved and sent",
  edited_approved: "It was edited, approved and sent",
  declined: "It was declined, and its draft deleted",
  done_in_app: "It was sent from Gmail",
  gone: "Its draft is no longer in Gmail",
  expired: "It expired",
  unconfirmed: "It was approved, but its app didn't confirm it was sent",
};

// A held send's own words where they differ: Mycel held the request, not Gmail.
const HELD_SEND_ENDINGS: Partial<Record<ReviewStatus, string>> = {
  declined: "It was declined, and its request deleted",
  gone: "Its request is no longer held",
  expired: "Nobody acted on it within 30 days, so it expired and its request was deleted",
  unconfirmed: "It was approved, but its app didn't confirm it was sent, so it may have gone",
};

/**
 * How a review ended, and by whom when someone in Mycel ended it. An escalation ends done by a
 * person in Mycel, or by a reply in Gmail (no one named), or with its message gone.
 */
function ending(review: Review): string {
  if (review.status === "waiting") return "";
  const by = review.endedBy === null ? "" : ` by ${review.endedBy}`;
  if (review.kind === "held_send") {
    return `${HELD_SEND_ENDINGS[review.status] ?? ENDINGS[review.status]}${by}.`;
  }
  if (review.kind !== "escalation") return `${ENDINGS[review.status]}${by}.`;
  if (review.status === "gone") return "The message is no longer in Gmail.";
  if (review.endedByUserId === null) return "It was replied to from Gmail.";
  return `It was marked done${by}.`;
}

/** Who has a handed-on review, as the viewer reads it. */
function handOffText(handOff: HandOff, viewerId: string): string {
  return handOff.to.id === viewerId
    ? `Handed to you by ${handOff.by.name}`
    : `Handed to ${handOff.to.name}`;
}

/** Who an org review is shared with, as the viewer knows them: "Shared with sales, support". */
function sharedText(tags: string[]): string {
  return tags.length === 0 ? "Shared inbox" : `Shared with ${tags.join(", ")}`;
}

/**
 * The caller's waiting reviews, oldest first: each one's workflow, kind and age, the tags it's
 * shared with (an org inbox's) and who it was handed to.
 */
export function ReviewsList({
  reviews,
  viewerId,
  now,
}: {
  reviews: ReviewSummary[];
  viewerId: string;
  now: Date;
}) {
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
              {review.handOff === null && review.sharedWith === null ? null : (
                <p className="text-xs text-muted-foreground">
                  {[
                    review.sharedWith === null ? null : sharedText(review.sharedWith),
                    review.handOff === null ? null : handOffText(review.handOff, viewerId),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </p>
              )}
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
 * decline; the escalated message, why it was handed over and a link to it in Gmail, with done;
 * or a held send's request and the fields it sends, with approve, edit and decline. While it waits, who it was handed to, and a colleague to hand it to when the caller
 * may. Once it has ended, how it ended and by whom.
 */
export function ReviewDetail({
  opened,
  viewerId,
  now,
}: {
  opened: OpenedReview;
  viewerId: string;
  now: Date;
}) {
  const { review, view, handOffTo } = opened;
  const waiting = review.status === "waiting" && view !== null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {review.workflowName} · {KIND_LABELS[review.kind]} · waiting {age(review.createdAt, now)}
      </p>
      {waiting && review.handOff !== null ? (
        <p className="text-sm font-medium">{handOffText(review.handOff, viewerId)}.</p>
      ) : null}
      {waiting ? (
        <WaitingItem review={review} view={view} />
      ) : (
        <p>This review has ended. {ending(review)}</p>
      )}
      {waiting && handOffTo.length > 0 ? (
        <HandOffForm reviewId={review.id} colleagues={handOffTo} />
      ) : null}
    </div>
  );
}

function WaitingItem({ review, view }: { review: Review; view: ItemView }) {
  if (view.kind === "held_send") {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>
              {view.app}: {view.action}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{view.description}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="font-mono text-xs break-all">
              {view.method} {view.url}
            </p>
            <dl className="flex flex-col gap-2 text-sm">
              {view.fields.map((field) => (
                <div key={field.name}>
                  <dt className="font-medium">{field.description}</dt>
                  <dd className="whitespace-pre-wrap">{field.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <HeldSendActions reviewId={review.id} fields={view.fields} />
      </>
    );
  }
  if (view.kind === "message") {
    return (
      <>
        {review.reason === null ? null : (
          <p className="text-sm">
            <span className="font-medium">Why it needs you:</span> {review.reason}
          </p>
        )}
        <Mail title="The message" mail={view.message} who={`From ${view.message.from}`} />
        <a
          href={view.link}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4"
        >
          Open it in Gmail
        </a>
        <EscalationActions reviewId={review.id} />
      </>
    );
  }
  return (
    <>
      {view.message === null ? (
        <p className="text-sm text-muted-foreground">The message it replies to is gone.</p>
      ) : (
        <Mail title="The message" mail={view.message} who={`From ${view.message.from}`} />
      )}
      <Mail title="The drafted reply" mail={view.draft} who={`To ${view.draft.to}`} />
      <ReviewActions reviewId={review.id} draftText={view.draft.text} />
    </>
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
