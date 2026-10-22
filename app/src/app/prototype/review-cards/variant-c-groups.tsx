// PROTOTYPE, throwaway: variant C's body: reviews grouped by app, each group with select-all
// and its own bulk buttons in that app's words, dense rows, and Open for a review's full
// preview in a dialog. Tasks closes the page: what Mycel added there, with no review.
"use client";

import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppIcon } from "./app-icon";
import { DecideButtons } from "./decide-buttons";
import { KindPreview } from "./kind-previews";
import { age, APP_NAMES, type Ending, KIND_LABELS } from "./review-copy";
import { ADDED_TASKS, type App, REVIEWS } from "./review-fixtures";
import { bulkBlocker, GroupRow } from "./variant-c-row";

const APPS: App[] = ["gmail", "calendar", "docs"];

const BULK: Record<App, { approve: string; decline: string }> = {
  gmail: { approve: "Approve and send", decline: "Decline" },
  calendar: { approve: "Approve and invite", decline: "Decline and delete" },
  docs: { approve: "Accept all", decline: "Reject all" },
};

type Decision = "approved" | "declined";

export function AppGroups({ ending }: { ending: Ending }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [decided, setDecided] = useState<Partial<Record<string, Decision>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = REVIEWS.find((review) => review.id === openId);

  function decide(ids: string[], decision: Decision) {
    setDecided({ ...decided, ...Object.fromEntries(ids.map((id) => [id, decision])) });
    setSelected(selected.filter((id) => !ids.includes(id)));
  }

  return (
    <div className="flex flex-col gap-5">
      {APPS.map((app) => {
        const reviews = REVIEWS.filter((review) => review.app === app);
        const waiting = reviews.filter((review) => decided[review.id] === undefined);
        const selectable = waiting.filter((review) => bulkBlocker(review) === null);
        const picked = selected.filter((id) => reviews.some((review) => review.id === id));
        const all = selectable.length > 0 && picked.length === selectable.length;
        return (
          <section key={app} aria-label={APP_NAMES[app]} className="rounded-xl border">
            <header className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
              <Checkbox
                aria-label={`Select all in ${APP_NAMES[app]}`}
                checked={all}
                disabled={selectable.length === 0}
                onCheckedChange={(value) => {
                  const ids = selectable.map((review) => review.id);
                  setSelected(
                    value === true
                      ? [...new Set([...selected, ...ids])]
                      : selected.filter((id) => !ids.includes(id)),
                  );
                }}
              />
              <AppIcon app={app} />
              <h2 className="font-medium">{APP_NAMES[app]}</h2>
              <span className="text-sm text-muted-foreground">{waiting.length} waiting</span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  disabled={picked.length === 0}
                  onClick={() => {
                    decide(picked, "approved");
                  }}
                >
                  {BULK[app].approve}
                  {picked.length === 0 ? "" : ` (${String(picked.length)})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={picked.length === 0}
                  onClick={() => {
                    decide(picked, "declined");
                  }}
                >
                  {BULK[app].decline}
                </Button>
              </div>
            </header>
            <ul className="divide-y">
              {reviews.map((review) => (
                <GroupRow
                  key={review.id}
                  review={review}
                  checked={selected.includes(review.id)}
                  decided={decided[review.id]}
                  onCheck={(checked) => {
                    setSelected(
                      checked
                        ? [...selected, review.id]
                        : selected.filter((id) => id !== review.id),
                    );
                  }}
                  onOpen={() => {
                    setOpenId(review.id);
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <TasksGroup />
      <Dialog
        open={opened !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        {opened === undefined ? null : (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {KIND_LABELS[opened.kind]} from {opened.workflowName}
              </DialogTitle>
              <DialogDescription>Waiting {age(opened.createdAt)}</DialogDescription>
            </DialogHeader>
            <KindPreview review={opened} />
            <div className="border-t pt-4">
              <DecideButtons review={opened} ending={ending} size="sm" />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function TasksGroup() {
  return (
    <section aria-label="Tasks" className="rounded-xl border border-dashed">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <AppIcon app="tasks" />
        <h2 className="font-medium">Tasks</h2>
        <span className="text-sm text-muted-foreground">
          No review needed. Mycel adds these to your own Tasks list; change or delete them there.
        </span>
      </header>
      <ul className="divide-y border-t text-sm">
        {ADDED_TASKS.map((task) => (
          <li key={task.title} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
            <span>{task.title}</span>
            <span className="text-xs text-muted-foreground">
              Due <DateTime value={task.due} day />
            </span>
            <span className="ml-auto text-xs text-muted-foreground">Added by {task.addedBy}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
