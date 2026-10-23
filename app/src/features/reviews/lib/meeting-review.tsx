// A waiting meeting on the Reviews page: the event as it is on the calendar now, fetched live
// and never stored, the guests approving it invites and how it will then show, with approve and
// decline.
import { DateTime } from "@/components/date-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventView } from "@/features/runtime/adapters";
import { MeetingActions } from "./review-actions";

const VISIBILITY: Record<EventView["visibility"], string> = {
  default: "with the calendar's usual visibility",
  public: "public",
  private: "private",
  confidential: "private",
};

export function MeetingReview({ reviewId, view }: { reviewId: string; view: EventView }) {
  const shows = `${VISIBILITY[view.visibility]}, ${
    view.transparency === "opaque" ? "showing you as busy" : "not blocking your time"
  }`;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{view.title === "" ? "Untitled meeting" : view.title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            <When value={view.start} /> to <When value={view.end} />
            {view.location === "" ? null : ` · ${view.location}`}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {view.description === "" ? null : (
            <p className="whitespace-pre-wrap">{view.description}</p>
          )}
          <p>
            <span className="font-medium">Approving invites:</span> {view.guests.join(", ")}
          </p>
          <p className="text-muted-foreground">
            Until then it&apos;s on your calendar with no guests, private and not blocking your
            time. Once approved it&apos;s {shows}.
          </p>
          <div className="flex gap-4">
            {view.link === "" ? null : (
              <a
                href={view.link}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Open it in Calendar
              </a>
            )}
            {view.meetLink === null ? null : (
              <a
                href={view.meetLink}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Meet link
              </a>
            )}
          </div>
        </CardContent>
      </Card>
      <MeetingActions reviewId={reviewId} />
    </>
  );
}

// A start or end: a time, or an all-day event's date.
function When({ value }: { value: string }) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return <>{value}</>;
  return <DateTime value={at} day={!value.includes("T")} />;
}
