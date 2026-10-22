"use client";

// PROTOTYPE, throwaway: variant B's sources pane. It shows what the selected reply drew on: the
// facts and their emails, files and invites, the messages found, or what a run will use. The
// fact under the pointer (here or in the answer) is highlighted in both places.
import Link from "next/link";
import { CalendarDays, FileText, Mail, ShieldAlert } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { workflowById } from "../_shared/fixtures";
import { PaneStatusB } from "./b-status";
import type { Message, Part } from "./conversation";
import { FACTS, MARKER_TEXT, factSources, type SourceApp } from "./facts";

export const HIGHLIGHT = "bg-amber-100 dark:bg-amber-400/20";

const APP_ICON: Record<SourceApp, typeof Mail> = {
  Gmail: Mail,
  Drive: FileText,
  Calendar: CalendarDays,
};

export function SourcesPane({
  message,
  hover,
  onHover,
  connection,
}: {
  message: Message | undefined;
  hover: string | null;
  onHover: (factId: string | null) => void;
  /** The viewer's own Google connection, which runs and message search use. */
  connection: string;
}) {
  return (
    <aside
      aria-label="Sources"
      className="hidden w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-muted/30 p-4 lg:flex"
    >
      <h2 className="text-sm font-semibold">Where this came from</h2>
      {message === undefined ? (
        <p className="text-sm text-muted-foreground">
          Pick one of Mycel&apos;s replies to see what it drew on.
        </p>
      ) : (
        message.parts.map((part, i) => (
          <PaneSection
            key={i}
            part={part}
            hover={hover}
            onHover={onHover}
            connection={connection}
          />
        ))
      )}
    </aside>
  );
}

function PaneSection({
  part,
  hover,
  onHover,
  connection,
}: {
  part: Part;
  hover: string | null;
  onHover: (factId: string | null) => void;
  connection: string;
}) {
  switch (part.kind) {
    case "answer":
    case "summary": {
      const ids =
        part.kind === "summary"
          ? part.factIds
          : part.lines.flatMap((l) => (l.factId === undefined ? [] : [l.factId]));
      if (ids.length === 0) return <Nothing text="This reply cites no facts." />;
      return (
        <ul className="flex flex-col gap-2">
          {ids.map((id) => (
            <FactItem key={id} id={id} hover={hover} onHover={onHover} />
          ))}
        </ul>
      );
    }
    case "unknown":
      return (
        <Nothing text="Memory searched everything you can see and found nothing on this, so Mycel didn't guess." />
      );
    case "screened":
      return (
        <p className="flex gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          <span>
            Left out of this answer: {part.text.replace(/^I left out /, "")} Mycel checks everything
            it reads for text that tries to give it orders.
          </span>
        </p>
      );
    case "messages":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            Searched {connection} for &ldquo;{part.query}&rdquo;. Mycel read only each
            message&apos;s sender, subject and date.
          </p>
          <ul className="divide-y rounded-md border bg-background">
            {part.messages.map((m) => (
              <li key={m.id} className="flex flex-col px-3 py-2">
                <span>{m.subject}</span>
                <span className="text-xs text-muted-foreground">
                  {m.from}, <DateTime value={m.at} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "proposedRun": {
      const workflow = workflowById(part.workflowId);
      return (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Workflow</dt>
          <dd>
            {workflow?.name}, version {String(workflow?.version)}
          </dd>
          <dt className="text-muted-foreground">Message</dt>
          <dd>
            {part.message.subject}
            <span className="block text-xs text-muted-foreground">
              {part.message.from}, <DateTime value={part.message.at} />
            </span>
          </dd>
          <dt className="text-muted-foreground">Acts as</dt>
          <dd>You, through {connection} only</dd>
          <dt className="text-muted-foreground">Then</dt>
          <dd>Its draft waits for you on the Reviews page. Nothing is sent without you.</dd>
        </dl>
      );
    }
    case "remembered":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            A fact about {part.about.name} ({part.about.key}), visible only to you.
          </p>
          {part.replaced === undefined ? null : (
            <p className="text-muted-foreground">
              Replaces <s>{part.replaced.statement}</s>, told{" "}
              <DateTime value={part.replaced.at} day />, kept as history.
            </p>
          )}
          <Link href="/prototype/told-facts" className="text-sm underline">
            Everything you&apos;ve told Mycel
          </Link>
        </div>
      );
    case "removed":
      return (
        <Nothing text="The connection this reply drew on was disconnected, so its sources went with it." />
      );
    case "outOfCredits":
      return <Nothing text="Mycel stopped before reading anything." />;
    case "reviews":
    case "workflows":
    case "refusal":
    case "noConnection":
      return <PaneStatusB part={part} />;
    case "text":
      return null;
  }
}

function FactItem({
  id,
  hover,
  onHover,
}: {
  id: string;
  hover: string | null;
  onHover: (factId: string | null) => void;
}) {
  const fact = FACTS[id];
  return (
    <li
      onMouseEnter={() => {
        onHover(id);
      }}
      onMouseLeave={() => {
        onHover(null);
      }}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-background p-3 text-sm transition-colors",
        hover === id && HIGHLIGHT,
      )}
    >
      <p>{fact.statement}</p>
      {fact.marker === undefined ? null : (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={fact.marker === "disputed" ? "destructive" : "outline"}>
            {MARKER_TEXT[fact.marker].label}
          </Badge>
          {MARKER_TEXT[fact.marker].hint}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {factSources(fact).map((s) => {
          const Icon = APP_ICON[s.app];
          return (
            <li key={s.id} className="flex items-start gap-1.5 text-xs">
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <a href={s.href} target="_blank" rel="noreferrer" className="underline">
                  {s.title}
                </a>
                <span className="text-muted-foreground">
                  {" "}
                  {s.who}, <DateTime value={s.at} day />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function Nothing({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
