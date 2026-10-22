"use client";

// PROTOTYPE, throwaway: variant C's cards for reviews, workflows and refusals. Reviews are a
// queue with Open buttons, workflows are status tiles, a refusal is a card naming the rule.
import Link from "next/link";
import { CircleSlash, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAUSED_TEXT, workflowById } from "../_shared/fixtures";
import { NO_CONNECTION, type Part, type WaitingReview } from "./conversation";
import { ago } from "./facts";
import { REFUSAL_TITLE, REVIEWS_HREF } from "./waiting";

export function ReviewQueue({ reviews }: { reviews: WaitingReview[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <ul className="divide-y">
        {reviews.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Badge variant="outline" className="w-28 justify-center">
              {r.kind}
            </Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {workflowById(r.workflowId)?.name}, {ago(r.waitingSince)}
              </span>
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`${REVIEWS_HREF}?review=${r.id}`}>Open</Link>
            </Button>
          </li>
        ))}
      </ul>
      <p className="border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Approving, editing and declining happen on{" "}
        <Link href={REVIEWS_HREF} className="underline">
          Reviews
        </Link>
        , never here.
      </p>
    </div>
  );
}

export function WorkflowTiles({ workflowIds }: { workflowIds: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {workflowIds.map((id) => {
        const w = workflowById(id);
        if (w === undefined) return null;
        return (
          <Link
            key={id}
            href="/workflows"
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50",
              w.paused !== null && "border-destructive/40",
            )}
          >
            <span className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  w.paused === null ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              {w.paused === null ? "On" : "Paused"}
            </span>
            <span className="font-medium">{w.name}</span>
            <span className="text-xs text-muted-foreground">
              {w.paused === null
                ? w.apps.join(" and ")
                : `${PAUSED_TEXT[w.paused]}${w.pausedSince === undefined ? "" : `, ${ago(w.pausedSince)}`}`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function RefusalCard({ part }: { part: Extract<Part, { kind: "refusal" }> }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
      <CircleSlash className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col items-start gap-2">
        <p className="font-medium">{REFUSAL_TITLE[part.reason]}: Mycel didn&apos;t do this</p>
        <p className="text-muted-foreground">{part.text}</p>
        {part.link === undefined ? null : (
          <Button variant="outline" size="sm" asChild>
            <Link href={part.link.href}>{part.link.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function NoConnectionCard() {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4 text-sm">
      <Unplug className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col items-start gap-2">
        <p>{NO_CONNECTION}</p>
        <Button size="sm" asChild>
          <Link href="/connections">Connect Google</Link>
        </Button>
      </div>
    </div>
  );
}
