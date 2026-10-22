"use client";

// PROTOTYPE, throwaway: variant A's lists and refusals, in the chat's plain idiom: bulleted
// lines with links, and refusals as a sentence that says why and what to do.
import Link from "next/link";
import { CircleSlash, Unplug } from "lucide-react";
import { PAUSED_TEXT, workflowById } from "../_shared/fixtures";
import { NO_CONNECTION, type Part, type WaitingReview } from "./conversation";
import { ago } from "./facts";
import { REVIEWS_HREF } from "./waiting";

export function ReviewsA({ reviews }: { reviews: WaitingReview[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1">
      {reviews.map((r) => (
        <li key={r.id}>
          <Link href={`${REVIEWS_HREF}?review=${r.id}`} className="underline">
            {r.title}
          </Link>{" "}
          <span className="text-muted-foreground">
            ({r.kind.toLowerCase()} from {workflowById(r.workflowId)?.name}, waiting{" "}
            {ago(r.waitingSince).replace(" ago", "")})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WorkflowsA({ workflowIds }: { workflowIds: string[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1">
      {workflowIds.map((id) => {
        const w = workflowById(id);
        if (w === undefined) return null;
        return (
          <li key={id}>
            <Link href="/workflows" className="font-medium underline">
              {w.name}
            </Link>
            {w.paused === null ? (
              <span className="text-muted-foreground">: on</span>
            ) : (
              <span className="text-destructive">
                : paused, {PAUSED_TEXT[w.paused]}
                {w.pausedSince === undefined ? null : ` (since ${ago(w.pausedSince)})`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RefusalA({ part }: { part: Extract<Part, { kind: "refusal" }> }) {
  return (
    <p className="flex items-start gap-2">
      <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        {part.text}{" "}
        {part.link === undefined ? null : (
          <Link href={part.link.href} className="underline">
            {part.link.label}
          </Link>
        )}
      </span>
    </p>
  );
}

export function NoConnectionA() {
  return (
    <p className="flex items-start gap-2 text-muted-foreground">
      <Unplug className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {NO_CONNECTION}{" "}
        <Link href="/connections" className="text-foreground underline">
          Connect Google
        </Link>
      </span>
    </p>
  );
}
