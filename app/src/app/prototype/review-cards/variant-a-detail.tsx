// PROTOTYPE, throwaway: variant A's opened reviews, in today's ReviewDetail shape (a line of
// context, then plain cards of what's waiting, then the buttons), one per kind.
import { DateTime } from "@/components/date-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecideButtons } from "./decide-buttons";
import { age, type Ending, endOf, guestsText, KIND_LABELS } from "./review-copy";
import type { DraftReview, EventReview, ReviewFx, SuggestionsReview } from "./review-fixtures";

function Context({ review }: { review: ReviewFx }) {
  return (
    <p className="text-sm text-muted-foreground">
      {review.workflowName} · {KIND_LABELS[review.kind]} · waiting {age(review.createdAt)}
    </p>
  );
}

export function DraftDetail({ review }: { review: DraftReview }) {
  return (
    <div className="flex flex-col gap-4">
      <Context review={review} />
      <Card>
        <CardHeader>
          <CardTitle>The message</CardTitle>
          <p className="text-sm text-muted-foreground">
            From {review.message.from} · {review.message.subject}
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{review.message.text}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>The drafted reply</CardTitle>
          <p className="text-sm text-muted-foreground">
            To {review.draft.to} · {review.draft.subject}
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{review.draft.text}</p>
        </CardContent>
      </Card>
      <DecideButtons review={review} />
    </div>
  );
}

export function EventDetail({ review, ending }: { review: EventReview; ending: Ending }) {
  return (
    <div className="flex flex-col gap-4">
      <Context review={review} />
      <Card>
        <CardHeader>
          <CardTitle>The event</CardTitle>
          <p className="text-sm text-muted-foreground">
            On {review.calendar}&apos;s calendar, private, with no guests yet and not blocking time
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Title</dt>
            <dd>{review.title}</dd>
            <dt className="text-muted-foreground">Starts</dt>
            <dd>
              <DateTime value={review.start} />
            </dd>
            <dt className="text-muted-foreground">Ends</dt>
            <dd>
              <DateTime value={endOf(review.start, review.minutes)} />
            </dd>
            <dt className="text-muted-foreground">Approving invites</dt>
            <dd>
              {guestsText(review.guests.length)}: {review.guests.join(", ")}
            </dd>
          </dl>
        </CardContent>
      </Card>
      <DecideButtons review={review} ending={ending} />
    </div>
  );
}

export function SuggestionsDetail({
  review,
  ending,
}: {
  review: SuggestionsReview;
  ending: Ending;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Context review={review} />
      <Card>
        <CardHeader>
          <CardTitle>Suggested edits in {review.docName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Visible in the doc as suggestions, not applied
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Mycel&apos;s suggestions</dt>
            <dd>{review.open} still open</dd>
            <dt className="text-muted-foreground">Your own</dt>
            <dd>
              {review.othersInDoc === 0
                ? "None"
                : `${String(review.othersInDoc)}, left alone either way`}
            </dd>
          </dl>
        </CardContent>
      </Card>
      <DecideButtons review={review} ending={ending} />
    </div>
  );
}
