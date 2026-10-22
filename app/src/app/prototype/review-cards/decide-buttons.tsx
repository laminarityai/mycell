// PROTOTYPE, throwaway: a review's approve and decline, stubbed on local state, plus the link
// out to the app (Docs, to pick among the suggestions; Gmail, for an escalation). A Calendar or
// Docs review that ended in the app shows how it ended instead.
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { actionLabels, decidedText, type Ending, endedText } from "./review-copy";
import type { ReviewFx } from "./review-fixtures";

export function DecideButtons({
  review,
  ending = "waiting",
  size = "default",
}: {
  review: ReviewFx;
  ending?: Ending;
  size?: "default" | "sm";
}) {
  const [decided, setDecided] = useState<"approved" | "declined" | null>(null);
  const appEnds = review.kind === "event" || review.kind === "suggestions";
  if (appEnds && ending !== "waiting") {
    return <p className="text-sm">This review has ended. {endedText(review, ending)}</p>;
  }
  if (decided !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="font-medium">{decidedText(review, decided === "approved")}</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDecided(null);
          }}
        >
          Reset (prototype)
        </Button>
      </div>
    );
  }
  const labels = actionLabels(review);
  const locked = review.kind === "suggestions" && !review.canEdit;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={size}
          disabled={locked}
          onClick={() => {
            setDecided("approved");
          }}
        >
          {labels.approve}
        </Button>
        {review.kind === "draft_reply" ? (
          <Button size={size} variant="outline">
            Edit
          </Button>
        ) : null}
        {review.kind === "escalation" ? null : (
          <Button
            size={size}
            variant="outline"
            disabled={locked}
            onClick={() => {
              setDecided("declined");
            }}
          >
            {labels.decline}
          </Button>
        )}
        {review.kind === "suggestions" ? (
          <a href="#opened" className="ml-1 text-sm underline underline-offset-4">
            Open the doc to pick among them
          </a>
        ) : null}
        {review.kind === "escalation" ? (
          <a href="#opened" className="ml-1 text-sm underline underline-offset-4">
            Open it in Gmail
          </a>
        ) : null}
      </div>
      {locked ? (
        <p className="text-sm text-muted-foreground">
          You can comment on this doc but not edit it, so Mycel can&apos;t accept or reject its
          suggestions for you. Open the doc to ask its owner: this review closes once they&apos;re
          handled.
        </p>
      ) : null}
    </div>
  );
}
