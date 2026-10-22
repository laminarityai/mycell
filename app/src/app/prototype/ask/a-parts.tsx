"use client";

// PROTOTYPE, throwaway: variant A's replies, as prose with numbered footnotes under each answer.
import Link from "next/link";
import { Ban, ShieldAlert, Unplug } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workflowById } from "../_shared/fixtures";
import {
  OUT_OF_CREDITS,
  REMOVED,
  type AnswerLine,
  type FoundMessage,
  type Part,
} from "./conversation";
import { NoConnectionA, RefusalA, ReviewsA, WorkflowsA } from "./a-lists";
import { FACTS, MARKER_TEXT, SOURCES, type Source } from "./facts";
import { STARTED_RUN_ID, type AskChat } from "./use-ask-chat";

export function PartA({ part, messageId, chat }: { part: Part; messageId: string; chat: AskChat }) {
  switch (part.kind) {
    case "text":
      return <p className="whitespace-pre-wrap">{chat.shownText(messageId, part.text)}</p>;
    case "answer":
      return <Footnoted scope={messageId} lines={part.lines} />;
    case "summary":
      return (
        <div className="flex flex-col gap-1">
          <p>{part.intro}</p>
          <Footnoted
            scope={messageId}
            lines={part.factIds.map((id) => ({ text: FACTS[id].statement, factId: id }))}
            list
          />
        </div>
      );
    case "unknown":
      return <p>{part.text}</p>;
    case "messages":
      return <Messages messages={part.messages} />;
    case "proposedRun":
      return (
        <ProposedRun
          messageId={messageId}
          workflowId={part.workflowId}
          message={part.message}
          chat={chat}
        />
      );
    case "remembered":
      return (
        <div className="flex flex-col gap-1">
          <p>
            Saved about <strong>{part.about.name}</strong> ({part.about.kind.toLowerCase()},{" "}
            {part.about.key}): &ldquo;{part.statement}&rdquo; Only you see it, and your workflows
            use it when they look things up for your inbox.
          </p>
          {part.replaced === undefined ? null : (
            <p className="text-muted-foreground">
              It replaces your note from <DateTime value={part.replaced.at} day />, &ldquo;
              {part.replaced.statement}&rdquo;, which is kept as history.{" "}
              <Link href="/prototype/told-facts" className="underline">
                See what you&apos;ve told Mycel
              </Link>
            </p>
          )}
        </div>
      );
    case "removed":
      return (
        <p className="flex items-center gap-2 text-muted-foreground italic">
          <Unplug className="size-4" aria-hidden /> {REMOVED}
        </p>
      );
    case "outOfCredits":
      return (
        <p role="status" className="flex items-center gap-2 text-destructive">
          <Ban className="size-4" aria-hidden /> {OUT_OF_CREDITS}
        </p>
      );
    case "screened":
      return (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {part.text}
        </p>
      );
    case "reviews":
      return <ReviewsA reviews={part.reviews} />;
    case "workflows":
      return <WorkflowsA workflowIds={part.workflowIds} />;
    case "refusal":
      return <RefusalA part={part} />;
    case "noConnection":
      return <NoConnectionA />;
  }
}

/** Sentences with footnote numbers, then the numbered sources they point to. */
function Footnoted({
  scope,
  lines,
  list = false,
}: {
  scope: string;
  lines: AnswerLine[];
  list?: boolean;
}) {
  const sources: Source[] = [];
  const numbered = lines.map((line) => {
    const fact = line.factId === undefined ? undefined : FACTS[line.factId];
    const numbers = (fact?.sourceIds ?? []).map((id) => {
      if (!sources.some((s) => s.id === id)) sources.push(SOURCES[id]);
      return sources.findIndex((s) => s.id === id) + 1;
    });
    return { line, fact, numbers };
  });
  const sentences = numbered.map(({ line, fact, numbers }, index) => (
    <span key={index}>
      {line.text}
      {numbers.map((n) => (
        <sup key={n} className="ml-0.5">
          <a
            href={`#fn-${scope}-${String(n)}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {n}
          </a>
        </sup>
      ))}
      {fact?.marker === undefined ? null : (
        <Badge
          variant={fact.marker === "disputed" ? "destructive" : "outline"}
          className="ml-1 align-middle"
          title={MARKER_TEXT[fact.marker].hint}
        >
          {MARKER_TEXT[fact.marker].label}
        </Badge>
      )}{" "}
    </span>
  ));
  return (
    <div className="flex flex-col gap-2">
      {list ? (
        <ul className="ml-4 list-disc space-y-1">
          {sentences.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="leading-relaxed">{sentences}</p>
      )}
      {sources.length === 0 ? null : (
        <ol className="flex flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground">
          {sources.map((source, i) => (
            <li
              key={source.id}
              id={`fn-${scope}-${String(i + 1)}`}
              className="flex flex-wrap gap-x-1.5"
            >
              <span className="tabular-nums">{i + 1}.</span>
              <a href={source.href} target="_blank" rel="noreferrer" className="underline">
                {source.title}
              </a>
              <span>
                {source.app === "Gmail" ? "email" : source.app === "Drive" ? "file" : "invite"} from{" "}
                {source.who}, <DateTime value={source.at} day />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Messages({ messages }: { messages: FoundMessage[] }) {
  return (
    <div className="flex flex-col gap-1">
      <ul className="divide-y rounded-md border text-sm">
        {messages.map((m) => (
          <li key={m.id} className="grid grid-cols-[10rem_1fr_auto] gap-3 px-3 py-1.5">
            <span className="truncate text-muted-foreground">{m.from}</span>
            <span className="truncate">{m.subject}</span>
            <span className="text-xs text-muted-foreground">
              <DateTime value={m.at} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Sender, subject and date only: Mycel never copies an email&apos;s text into the chat.
      </p>
    </div>
  );
}

function ProposedRun({
  messageId,
  workflowId,
  message,
  chat,
}: {
  messageId: string;
  workflowId: string;
  message: FoundMessage;
  chat: AskChat;
}) {
  const workflow = workflowById(workflowId);
  const state = chat.runState(messageId);
  return (
    <div className="flex flex-col gap-2">
      <p>
        Run <strong>{workflow?.name}</strong> on this message?
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <div className="text-sm">
          <div>{message.subject}</div>
          <div className="text-xs text-muted-foreground">
            {message.from}, <DateTime value={message.at} />
          </div>
        </div>
        {state === "proposed" ? (
          <Button
            size="sm"
            onClick={() => {
              chat.run(messageId);
            }}
          >
            Run
          </Button>
        ) : (
          <Badge variant="secondary">{state === "started" ? "Run started" : "Run finished"}</Badge>
        )}
      </div>
      {state === "proposed" ? (
        <p className="text-xs text-muted-foreground">
          Nothing starts until you press Run. Its draft will wait for you on the Reviews page.
        </p>
      ) : (
        <p className="text-sm">
          {state === "started" ? "The run is under way." : "The run drafted a reply."}{" "}
          <Link href={`/prototype/run?run=${STARTED_RUN_ID}`} className="underline">
            Follow the run
          </Link>
          . The draft waits for you on the{" "}
          <Link href="/reviews" className="underline">
            Reviews page
          </Link>
          ; nothing is sent until you approve it there.
        </p>
      )}
    </div>
  );
}
