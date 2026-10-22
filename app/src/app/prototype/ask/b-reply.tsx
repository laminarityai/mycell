"use client";

// PROTOTYPE, throwaway: variant B's replies in the thread. Prose with no citation marks: each
// cited sentence is underlined faintly and lights up with its fact in the sources pane.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workflowById } from "../_shared/fixtures";
import { OUT_OF_CREDITS, REMOVED, type AnswerLine, type Part } from "./conversation";
import { FACTS, MARKER_TEXT } from "./facts";
import { HIGHLIGHT } from "./b-pane";
import { ReplyStatusB } from "./b-status";
import { STARTED_RUN_ID, type AskChat } from "./use-ask-chat";

export function ReplyB({
  part,
  messageId,
  chat,
  hover,
  onHover,
}: {
  part: Part;
  messageId: string;
  chat: AskChat;
  hover: string | null;
  onHover: (factId: string | null) => void;
}) {
  switch (part.kind) {
    case "text":
      return <p className="whitespace-pre-wrap">{chat.shownText(messageId, part.text)}</p>;
    case "answer":
      return <Prose lines={part.lines} hover={hover} onHover={onHover} />;
    case "summary":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-medium">
            {part.subject.name}{" "}
            <span className="font-normal text-muted-foreground">({part.subject.key})</span>
          </p>
          <Prose
            lines={part.factIds.map((id) => ({ text: FACTS[id].statement, factId: id }))}
            hover={hover}
            onHover={onHover}
          />
          <p className="text-xs text-muted-foreground">{part.intro}</p>
        </div>
      );
    case "unknown":
      return <p>{part.text}</p>;
    case "messages":
      return (
        <ul className="flex flex-col gap-0.5">
          {part.messages.map((m) => (
            <li key={m.id}>
              <span className="font-medium">{m.subject}</span>{" "}
              <span className="text-muted-foreground">
                from {m.from}, <DateTime value={m.at} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "proposedRun": {
      const state = chat.runState(messageId);
      const workflow = workflowById(part.workflowId);
      return (
        <div className="flex flex-col gap-2">
          <p>
            I can run <strong>{workflow?.name}</strong> on &ldquo;{part.message.subject}&rdquo; from{" "}
            {part.message.from} (<DateTime value={part.message.at} />
            ).
          </p>
          {state === "proposed" ? (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => {
                  chat.run(messageId);
                }}
              >
                Run
              </Button>
              <span className="text-xs text-muted-foreground">
                Nothing starts until you press it.
              </span>
            </div>
          ) : (
            <p>
              <Badge variant="secondary">
                {state === "started" ? "Run started" : "Run finished"}
              </Badge>{" "}
              <Link href={`/prototype/run?run=${STARTED_RUN_ID}`} className="underline">
                Open the run
              </Link>
              . Its draft reply waits for you on{" "}
              <Link href="/reviews" className="underline">
                Reviews
              </Link>
              .
            </p>
          )}
        </div>
      );
    }
    case "remembered":
      return (
        <p>
          Saved. About {part.about.name}: &ldquo;{part.statement}&rdquo; Only you see it.
          {part.replaced === undefined
            ? null
            : " It replaces your older note, which is kept as history."}
        </p>
      );
    case "removed":
      return <p className="text-muted-foreground italic">{REMOVED}</p>;
    case "outOfCredits":
      return (
        <p role="status" className="text-destructive">
          {OUT_OF_CREDITS}
        </p>
      );
    case "screened":
      return <p className="text-xs text-muted-foreground">One item left out, see the sources.</p>;
    case "reviews":
    case "workflows":
    case "refusal":
    case "noConnection":
      return <ReplyStatusB part={part} />;
  }
}

function Prose({
  lines,
  hover,
  onHover,
}: {
  lines: AnswerLine[];
  hover: string | null;
  onHover: (factId: string | null) => void;
}) {
  return (
    <p className="leading-relaxed">
      {lines.map((line, i) => {
        const factId = line.factId;
        if (factId === undefined) return <span key={i}>{line.text} </span>;
        const marker = FACTS[factId].marker;
        return (
          <span key={i}>
            <span
              onMouseEnter={() => {
                onHover(factId);
              }}
              onMouseLeave={() => {
                onHover(null);
              }}
              className={cn(
                "rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 transition-colors",
                hover === factId && HIGHLIGHT,
              )}
            >
              {line.text}
            </span>
            {marker === undefined ? null : (
              <Badge
                variant={marker === "disputed" ? "destructive" : "outline"}
                className="ml-1 align-middle"
              >
                {MARKER_TEXT[marker].label}
              </Badge>
            )}{" "}
          </span>
        );
      })}
    </p>
  );
}
