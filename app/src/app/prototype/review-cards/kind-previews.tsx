// PROTOTYPE, throwaway: kind-specific previews of what a review holds, for variants B and C:
// a held event as an event card (when, how it sits on the calendar now, who approving invites),
// Docs suggestions as a summary of what changes (counts only, no document text), and mail.
import { EyeOff, Lock, type LucideIcon, Mail, UserRoundX } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { guestsText } from "./review-copy";
import type {
  DraftReview,
  EscalationReview,
  EventReview,
  ReviewFx,
  SuggestionsReview,
} from "./review-fixtures";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How a held event sits on the person's calendar until it's approved (issue 67, Calendar). */
const HELD_AS: { icon: LucideIcon; label: string }[] = [
  { icon: UserRoundX, label: "No guests yet" },
  { icon: Lock, label: "Private" },
  { icon: EyeOff, label: "Doesn't block your time" },
];

/** A calendar-page tile: "Thu / 24 / Oct" (the UTC day). */
export function DateTile({ value, className }: { value: Date; className?: string }) {
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background text-center",
        className,
      )}
    >
      <span className="w-full bg-muted py-0.5 text-[10px] font-medium text-muted-foreground">
        {DAYS[value.getUTCDay()]}
      </span>
      <span className="text-xl leading-7 font-semibold">{value.getUTCDate()}</span>
      <span className="pb-1 text-[10px] text-muted-foreground">{MONTHS[value.getUTCMonth()]}</span>
    </div>
  );
}

export function EventPreview({ review }: { review: EventReview }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex gap-4">
        <DateTile value={review.start} />
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-semibold">{review.title}</p>
          <p>
            <DateTime value={review.start} />, {review.minutes} minutes
          </p>
          <p className="text-muted-foreground">On {review.calendar}&apos;s calendar</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-medium">On your calendar now</p>
        <ul className="flex flex-wrap gap-2 text-xs">
          {HELD_AS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-medium">Approving invites {guestsText(review.guests.length)}</p>
        <ul className="flex flex-col gap-1">
          {review.guests.map((guest) => (
            <li key={guest} className="flex items-center gap-2">
              <Mail className="size-3.5 text-muted-foreground" aria-hidden />
              {guest}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          They get Google&apos;s invitation email, and the event then shows as busy. Declining
          deletes it.
        </p>
      </div>
    </div>
  );
}

export function SuggestionsPreview({ review }: { review: SuggestionsReview }) {
  const total = review.wordsAdded + review.wordsRemoved;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center gap-3">
        <AppIcon app="docs" className="size-10" />
        <div>
          <p className="text-base font-semibold">{review.docName}</p>
          <p className="text-muted-foreground">
            {review.open} suggestions from Mycel, not applied yet
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className="bg-emerald-600"
            style={{ width: `${String((review.wordsAdded / total) * 100)}%` }}
          />
          <span
            className="bg-destructive"
            style={{ width: `${String((review.wordsRemoved / total) * 100)}%` }}
          />
        </div>
        <dl className="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1">
          <dt>
            {review.insertions} insertion{review.insertions === 1 ? "" : "s"}
          </dt>
          <dd className="text-emerald-700 dark:text-emerald-400">
            about {review.wordsAdded} words added
          </dd>
          <dt>
            {review.deletions} deletion{review.deletions === 1 ? "" : "s"}
          </dt>
          <dd className="text-destructive">
            {review.wordsRemoved === 0
              ? "nothing removed"
              : `about ${String(review.wordsRemoved)} words removed`}
          </dd>
        </dl>
      </div>
      <div className="flex flex-col gap-1.5">
        <p>
          Touches {review.sectionsTouched} of the doc&apos;s {review.sectionsTotal} sections
        </p>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: review.sectionsTotal }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-6 flex-1 rounded-sm border",
                i < review.sectionsTouched ? "bg-foreground/80" : "bg-muted/50",
              )}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {review.othersInDoc === 0
          ? "No one else has suggestions open in this doc."
          : `Your own ${String(review.othersInDoc)} suggestions in the doc stay as they are either way.`}{" "}
        Mycel shows what changes, not the doc&apos;s text: open the doc to read each suggestion, or
        to accept some and reject others.
      </p>
    </div>
  );
}

export function DraftPreview({ review }: { review: DraftReview }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          From {review.message.from}: {review.message.subject}
        </p>
        <p className="mt-1">{review.message.text}</p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">
          Draft to {review.draft.to}: {review.draft.subject}
        </p>
        <p className="mt-1 whitespace-pre-wrap">{review.draft.text}</p>
      </div>
    </div>
  );
}

export function EscalationPreview({ review }: { review: EscalationReview }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <span className="font-medium">Why it needs you:</span> {review.reason}
      </p>
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          From {review.message.from}: {review.message.subject}
        </p>
        <p className="mt-1">{review.message.text}</p>
      </div>
    </div>
  );
}

export function KindPreview({ review }: { review: ReviewFx }) {
  switch (review.kind) {
    case "event":
      return <EventPreview review={review} />;
    case "suggestions":
      return <SuggestionsPreview review={review} />;
    case "draft_reply":
      return <DraftPreview review={review} />;
    case "escalation":
      return <EscalationPreview review={review} />;
  }
}
