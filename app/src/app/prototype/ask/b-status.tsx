"use client";

// PROTOTYPE, throwaway: variant B's reviews, workflows and refusals. The thread keeps them to a
// sentence or a line each; the sources pane holds the detail, and for a refusal the checks Mycel
// made before saying no.
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PAUSED_TEXT, workflowById } from "../_shared/fixtures";
import { NO_CONNECTION, type Part } from "./conversation";
import { ago } from "./facts";
import { REVIEWS_HREF } from "./waiting";

type StatusPart = Extract<Part, { kind: "reviews" | "workflows" | "refusal" | "noConnection" }>;

export function ReplyStatusB({ part }: { part: StatusPart }) {
  switch (part.kind) {
    case "reviews":
      return (
        <ul className="flex flex-col gap-0.5">
          {part.reviews.map((r) => (
            <li key={r.id}>
              <Link href={`${REVIEWS_HREF}?review=${r.id}`} className="underline">
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      );
    case "workflows":
      return (
        <p className="leading-relaxed">
          {part.workflowIds.map((id) => {
            const w = workflowById(id);
            if (w === undefined) return null;
            return (
              <span key={id}>
                <strong>{w.name}</strong>{" "}
                {w.paused === null ? "is on." : `is paused: ${PAUSED_TEXT[w.paused]}.`}{" "}
              </span>
            );
          })}
        </p>
      );
    case "refusal":
      return (
        <p>
          <Badge variant="outline" className="mr-1.5 align-middle">
            Didn&apos;t do it
          </Badge>
          {part.text}{" "}
          {part.link === undefined ? null : (
            <Link href={part.link.href} className="underline">
              {part.link.label}
            </Link>
          )}
        </p>
      );
    case "noConnection":
      return <p className="text-muted-foreground">{NO_CONNECTION}</p>;
  }
}

const CHECKS: Record<Extract<Part, { kind: "refusal" }>["reason"], [string, boolean][]> = {
  paused: [
    ["You've switched it on", true],
    ["It runs on your own connection", true],
    ["It isn't paused", false],
  ],
  underWay: [
    ["You've switched it on", true],
    ["It isn't paused", true],
    ["No run of it on this message is under way", false],
  ],
  doNotLearn: [
    ["It's a statement about a person", true],
    ["The person isn't on the do-not-learn list", false],
  ],
  noConnection: [["You've connected Google", false]],
};

export function PaneStatusB({ part }: { part: StatusPart }) {
  switch (part.kind) {
    case "reviews":
      return (
        <ul className="flex flex-col divide-y rounded-md border bg-background text-sm">
          {part.reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
              <Link href={`${REVIEWS_HREF}?review=${r.id}`} className="underline">
                {r.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {r.kind} from {workflowById(r.workflowId)?.name}, waiting since{" "}
                {ago(r.waitingSince)}
              </span>
            </li>
          ))}
        </ul>
      );
    case "workflows":
      return (
        <ul className="flex flex-col gap-2 text-sm">
          {part.workflowIds.map((id) => {
            const w = workflowById(id);
            if (w === undefined) return null;
            return (
              <li key={id} className="flex flex-col gap-1 rounded-md border bg-background p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{w.name}</span>
                  <Badge variant={w.paused === null ? "secondary" : "destructive"}>
                    {w.paused === null ? "On" : "Paused"}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {w.apps.join(" and ")}, version {String(w.version)}
                  {w.budget === null
                    ? ""
                    : `, ${String(w.spentThisMonth)} of ${String(w.budget)} credits this month`}
                </span>
                {w.paused === null ? null : (
                  <span className="text-xs">
                    Paused {w.pausedSince === undefined ? "" : ago(w.pausedSince)}:{" "}
                    {PAUSED_TEXT[w.paused]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      );
    case "refusal":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">What Mycel checked before saying no:</p>
          <ul className="flex flex-col gap-1">
            {CHECKS[part.reason].map(([check, passed]) => (
              <li
                key={check}
                className={cn("flex items-center gap-2", !passed && "text-destructive")}
              >
                {passed ? (
                  <Check className="size-4" aria-label="Yes" />
                ) : (
                  <X className="size-4" aria-label="No" />
                )}
                {check}
              </li>
            ))}
          </ul>
        </div>
      );
    case "noConnection":
      return (
        <p className="text-sm text-muted-foreground">
          Searched company-wide memory only. Your own mail needs a Google connection.{" "}
          <Link href="/connections" className="text-foreground underline">
            Connect Google
          </Link>
        </p>
      );
  }
}
