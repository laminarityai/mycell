// PROTOTYPE, throwaway: variant A, today's Reviews table kept as is, with an app icon in the
// Kind column and a one-line summary under each workflow name; below it, one opened review per
// kind in today's detail shape, picked with tabs.
import type { ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { AppIcon } from "./app-icon";
import { age, asEnding, guestsText, KIND_LABELS } from "./review-copy";
import { ADDED_TASKS, OPENED, REVIEWS, type ReviewFx } from "./review-fixtures";
import { DraftDetail, EventDetail, SuggestionsDetail } from "./variant-a-detail";

function summary(review: ReviewFx): ReactNode {
  switch (review.kind) {
    case "draft_reply":
      return `To ${review.draft.to}: ${review.draft.subject}`;
    case "escalation":
      return review.reason;
    case "event":
      return (
        <>
          <DateTime value={review.start} />, invites{" "}
          {review.guests.length === 1 ? review.guests[0] : guestsText(review.guests.length)}
        </>
      );
    case "suggestions":
      return `${String(review.open)} suggested edits in ${review.docName}`;
  }
}

export function VariantA({ params }: VariantProps) {
  const ending = asEnding(params.state);
  return (
    <PrototypeMain>
      <PrototypeHeader title="Reviews" admin={false} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workflow</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Waiting</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {REVIEWS.map((review) => (
            <TableRow key={review.id}>
              <TableCell className="whitespace-normal">
                <a href="#opened" className="font-medium hover:underline">
                  {review.workflowName}
                </a>
                <p className="text-xs text-muted-foreground">
                  {summary(review)}
                  {review.sharedWith === undefined ? null : ` · ${review.sharedWith}`}
                </p>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <AppIcon app={review.app} className="size-6" />
                  <Badge variant="outline">{KIND_LABELS[review.kind]}</Badge>
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{age(review.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <AppIcon app="tasks" className="size-6" />
        <span>
          Tasks Mycel adds to your Tasks list don&apos;t need a review: {ADDED_TASKS.length} were
          added today, each saying &ldquo;Added by {ADDED_TASKS[0].addedBy}&rdquo; in its notes.
        </span>
      </p>
      <section id="opened" className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">An opened review, by kind</h2>
        <Tabs defaultValue="event">
          <TabsList>
            <TabsTrigger value="draft">Gmail draft</TabsTrigger>
            <TabsTrigger value="event">Calendar event</TabsTrigger>
            <TabsTrigger value="suggestions">Doc edits</TabsTrigger>
          </TabsList>
          <TabsContent value="draft" className="pt-3">
            <DraftDetail review={OPENED.draft} />
          </TabsContent>
          <TabsContent value="event" className="pt-3">
            <EventDetail review={OPENED.event} ending={ending} />
          </TabsContent>
          <TabsContent value="suggestions" className="pt-3">
            <SuggestionsDetail review={OPENED.suggestions} ending={ending} />
          </TabsContent>
        </Tabs>
      </section>
    </PrototypeMain>
  );
}
