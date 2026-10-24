// An open review of edits a step suggested in a Doc (ADR-0017): the doc's link, what each of the
// step's suggestions still in it changes, fetched live and never stored, and approve (accept them
// all) and decline (reject them all). Without edit access to the doc, only the link: its editors
// accept or reject the suggestions in Docs.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuggestedEditsView } from "@/features/runtime/adapters";
import { SuggestedEditsActions } from "./review-actions";

export function SuggestedEditsReview({
  reviewId,
  view,
}: {
  reviewId: string;
  view: SuggestedEditsView;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{view.title === "" ? "Untitled document" : view.title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {view.changes.length === 1
              ? "One suggested edit waits in the doc."
              : `${String(view.changes.length)} suggested edits wait in the doc.`}
          </p>
        </CardHeader>
        <CardContent>
          <ul aria-label="Suggested edits" className="flex flex-col gap-2 text-sm">
            {view.changes.map((change, index) => (
              <li key={index} className="flex flex-col gap-1 border-l-2 pl-3">
                {change.removed === "" ? null : (
                  <p className="whitespace-pre-wrap text-muted-foreground line-through">
                    {change.removed}
                  </p>
                )}
                {change.added === "" ? null : <p className="whitespace-pre-wrap">{change.added}</p>}
                {change.restyled ? (
                  <p className="text-muted-foreground">Changes the text&apos;s formatting.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <a
        href={view.link}
        target="_blank"
        rel="noreferrer"
        className="text-sm underline underline-offset-4"
      >
        Open the doc to pick among the suggestions
      </a>
      {view.canEdit === false ? (
        <p className="text-sm text-muted-foreground">
          This account can only comment on the doc, so its editors accept or reject the suggestions
          there.
        </p>
      ) : (
        <SuggestedEditsActions reviewId={reviewId} />
      )}
    </>
  );
}
