// PROTOTYPE, throwaway: variant B's body: a column of review cards, each previewing its kind in
// a line or two (the event's day and guests, the doc's change counts, the draft's recipient),
// and beside it the selected review opened with its kind's full preview and buttons.
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { DecideButtons } from "./decide-buttons";
import { DateTile, KindPreview } from "./kind-previews";
import { age, type Ending, guestsText, KIND_LABELS } from "./review-copy";
import { ADDED_TASKS, REVIEWS, type ReviewFx } from "./review-fixtures";

export function SplitView({ ending }: { ending: Ending }) {
  const [selectedId, setSelectedId] = useState(REVIEWS[0].id);
  const selected = REVIEWS.find((review) => review.id === selectedId) ?? REVIEWS[0];
  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2" aria-label="Waiting reviews">
          {REVIEWS.map((review) => (
            <li key={review.id}>
              <button
                type="button"
                aria-pressed={review.id === selectedId}
                onClick={() => {
                  setSelectedId(review.id);
                }}
                className={cn(
                  "flex w-full gap-3 rounded-xl border p-3 text-left text-sm hover:bg-muted/50",
                  review.id === selectedId && "border-foreground/40 bg-muted/60",
                )}
              >
                <CardLead review={review} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{headline(review)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {age(review.createdAt)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{detail(review)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {review.workflowName}
                    {review.sharedWith === undefined ? "" : `. ${review.sharedWith}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          <AppIcon app="tasks" />
          <p>
            {ADDED_TASKS.length} tasks added to your Tasks list today with no review. Each says
            &ldquo;Added by {ADDED_TASKS[0].addedBy}&rdquo;, and you can change or delete them in
            Tasks.
          </p>
        </div>
      </div>
      <section
        aria-label="Opened review"
        className="sticky top-4 flex flex-col gap-5 rounded-xl border p-5"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AppIcon app={selected.app} />
          <span>
            {KIND_LABELS[selected.kind]} from {selected.workflowName}, waiting{" "}
            {age(selected.createdAt)}
          </span>
        </div>
        <KindPreview review={selected} />
        <div className="border-t pt-4">
          <DecideButtons key={selected.id} review={selected} ending={ending} />
        </div>
      </section>
    </div>
  );
}

function CardLead({ review }: { review: ReviewFx }) {
  if (review.kind === "event") return <DateTile value={review.start} className="w-11" />;
  return <AppIcon app={review.app} className="size-11" />;
}

function headline(review: ReviewFx): string {
  switch (review.kind) {
    case "event":
      return review.title;
    case "suggestions":
      return review.docName;
    case "draft_reply":
      return review.draft.subject;
    case "escalation":
      return review.message.subject;
  }
}

function detail(review: ReviewFx): string {
  switch (review.kind) {
    case "event":
      return `${String(review.minutes)} min, invites ${guestsText(review.guests.length)}`;
    case "suggestions":
      return `${String(review.open)} suggestions, +${String(review.wordsAdded)} / −${String(review.wordsRemoved)} words`;
    case "draft_reply":
      return `Draft reply to ${review.draft.to}`;
    case "escalation":
      return review.reason;
  }
}
