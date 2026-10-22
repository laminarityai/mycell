// PROTOTYPE, throwaway: one dense row in variant C's app groups: a checkbox for bulk approval
// (or why it can't be bulk-approved), the kind's key facts on one line, its age, and Open.
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { age, decidedText, guestsText } from "./review-copy";
import type { ReviewFx } from "./review-fixtures";

/** Why a review can't be approved in bulk, if it can't. */
export function bulkBlocker(review: ReviewFx): string | null {
  if (review.kind === "escalation") return "Open to handle";
  if (review.kind === "suggestions" && !review.canEdit) return "Needs edit access";
  return null;
}

export function GroupRow({
  review,
  checked,
  decided,
  onCheck,
  onOpen,
}: {
  review: ReviewFx;
  checked: boolean;
  decided: "approved" | "declined" | undefined;
  onCheck: (checked: boolean) => void;
  onOpen: () => void;
}) {
  const blocker = bulkBlocker(review);
  return (
    <li
      className={cn(
        "grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:grid-cols-[1.25rem_1fr_6rem_auto]",
        checked && "bg-muted/50",
        decided !== undefined && "text-muted-foreground",
      )}
    >
      {decided === undefined ? (
        <Checkbox
          aria-label={`Select ${review.workflowName}`}
          checked={checked}
          disabled={blocker !== null}
          onCheckedChange={(value) => {
            onCheck(value === true);
          }}
        />
      ) : (
        <span />
      )}
      <div className="min-w-0">
        {decided === undefined ? (
          <p className="truncate">
            <KeyFacts review={review} />
          </p>
        ) : (
          <p className="truncate">{decidedText(review, decided === "approved")}</p>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {review.workflowName}
          {review.sharedWith === undefined ? "" : `. ${review.sharedWith}`}
          {blocker === null ? "" : `. ${blocker}`}
        </p>
      </div>
      <span className="hidden text-xs text-muted-foreground sm:block">{age(review.createdAt)}</span>
      {decided === undefined ? (
        <Button size="sm" variant="outline" onClick={onOpen}>
          Open
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}

function KeyFacts({ review }: { review: ReviewFx }) {
  switch (review.kind) {
    case "event":
      return (
        <>
          <span className="font-medium">
            <DateTime value={review.start} />
          </span>{" "}
          {review.title}
          <span className="text-muted-foreground">
            , invites{" "}
            {review.guests.length === 1 ? review.guests[0] : guestsText(review.guests.length)}
          </span>
        </>
      );
    case "suggestions":
      return (
        <>
          <span className="font-medium">{review.docName}</span>
          <span className="text-muted-foreground">
            , {review.open} suggestions, +{review.wordsAdded} / −{review.wordsRemoved} words
          </span>
        </>
      );
    case "draft_reply":
      return (
        <>
          <span className="font-medium">{review.draft.to}</span>{" "}
          <span className="text-muted-foreground">{review.draft.subject}</span>
        </>
      );
    case "escalation":
      return (
        <>
          <span className="font-medium">{review.message.from}</span>{" "}
          <span className="text-muted-foreground">{review.reason}</span>
        </>
      );
  }
}
