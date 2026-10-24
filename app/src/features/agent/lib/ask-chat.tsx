"use client";

// One Ask Mycel conversation: the stored messages, then each turn as it streams in, each reply
// with its facts as numbered footnotes linking the email, doc or invite they came from, and the
// composer pinned below. Only the person's new message goes to the server, which holds the rest;
// when a turn ends the page reads the conversation again for its new citations.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentUIMessage, Citation, CitedSource, ProposeRunResult } from "../types";
import { numberSources, segments } from "./footnotes";
import { ProposeRunPart } from "./pending-run-card";

/** Ask Mycel's AI disclosure (EU AI Act Art. 50), above every conversation. */
const DISCLOSURE =
  "You're talking to Mycel, an AI. It answers only from what you can see in memory, and it can be wrong, so check its sources. Being an admin doesn't let it see more. Only you can see this conversation.";

const TOOL_LABELS: Record<string, string> = {
  search_memory: "Searched memory",
  read_object: "Read memory",
  propose_run: "Offered a run",
};

/** What a cited source is, and where the person's copy of it lives. */
const SOURCE_NAMES: Record<CitedSource["kind"], string> = {
  email: "Email",
  doc: "Google Doc",
  invite: "Calendar invite",
};
const SOURCE_PLACES: Record<CitedSource["kind"], string> = {
  email: "mailbox",
  doc: "Drive",
  invite: "calendar",
};

type Part = AgentUIMessage["parts"][number];

export function AskChat({
  conversationId,
  initialMessages,
  citations,
}: {
  conversationId: string;
  initialMessages: AgentUIMessage[];
  /** The facts the conversation's replies read, as the server last read them. */
  citations: Citation[];
}) {
  const router = useRouter();
  const cited = useMemo(() => new Map(citations.map((c) => [c.factId, c])), [citations]);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<AgentUIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/agent/turn",
      prepareSendMessagesRequest: ({ messages: all }) => ({
        body: { conversationId, message: textOf(all.at(-1)) },
      }),
    }),
    // The reply's citations, and the rail's order and title, are read again.
    onFinish: () => {
      router.refresh();
    },
  });
  const busy = status === "submitted" || status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);
  const lastLength = messages.at(-1)?.parts.length ?? 0;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, lastLength]);
  const send = () => {
    const text = input.trim();
    if (text === "" || busy) return;
    void sendMessage({ text });
    setInput("");
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Conversation">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
          <p className="mx-auto max-w-lg rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
            {DISCLOSURE}
          </p>
          {messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              Ask about a customer, a supplier, a deal or a policy.
            </p>
          ) : null}
          <ol className="flex flex-col gap-5" aria-label="Messages">
            {messages.map((message) =>
              message.role === "user" ? (
                <li
                  key={message.id}
                  className="max-w-[80%] self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                >
                  {textOf(message)}
                </li>
              ) : (
                <li key={message.id} className="flex gap-3 text-sm">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"
                  >
                    <Sparkles className="size-3.5" />
                  </span>
                  <Reply message={message} cited={cited} />
                </li>
              ),
            )}
          </ol>
          {error === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error.message || "Mycel couldn't answer. Try again."}
            </p>
          )}
        </div>
      </div>
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            aria-label="Message to Mycel"
            value={input}
            rows={1}
            placeholder="Ask about a customer, a supplier, a deal or a policy…"
            className="max-h-40 min-h-9 resize-none border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => {
              setInput(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" disabled={busy || input.trim() === ""}>
            {busy ? "Answering…" : "Send"}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Mycel is an AI and can be wrong. It never acts in your apps.
        </p>
      </form>
    </section>
  );
}

/** Mycel's reply: its parts in order, then the numbered sources its footnotes point to. */
function Reply({ message, cited }: { message: AgentUIMessage; cited: Map<string, Citation> }) {
  const texts = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
  const { sources, numbers } = numberSources(texts, cited);
  const scope = message.id;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Mycel</span>
      {message.parts.map((part, index) => (
        <ReplyPart key={index} part={part} scope={scope} numbers={numbers} cited={cited} />
      ))}
      {sources.length === 0 ? null : (
        <ol
          className="flex flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground"
          aria-label="Sources"
        >
          {sources.map((source, i) => (
            <li key={source.key} id={`fn-${scope}-${String(i + 1)}`} className="flex gap-1.5">
              <span className="tabular-nums">{i + 1}.</span>
              {source.href === null ? (
                <span>{SOURCE_NAMES[source.kind]}</span>
              ) : (
                <a href={source.href} target="_blank" rel="noreferrer" className="underline">
                  {SOURCE_NAMES[source.kind]}
                </a>
              )}
              <span>
                {source.yours ? "in your " : "seen by you, not in your "}
                {SOURCE_PLACES[source.kind]}, <DateTime value={source.occurredAt} day />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReplyPart({
  part,
  scope,
  numbers,
  cited,
}: {
  part: Part;
  scope: string;
  numbers: Map<string, number[]>;
  cited: Map<string, Citation>;
}) {
  if (part.type === "text") {
    return (
      <p className="leading-relaxed whitespace-pre-wrap">
        {segments(part.text).map((segment, i) =>
          segment.kind === "text" ? (
            <span key={i}>{segment.text}</span>
          ) : (
            <Footnote
              key={i}
              scope={scope}
              numbers={numbers.get(segment.factId) ?? []}
              citation={cited.get(segment.factId)}
            />
          ),
        )}
      </p>
    );
  }
  if (part.type === "data-notice") {
    return (
      <p role="status" className="text-sm text-destructive">
        {part.data.text}
      </p>
    );
  }
  if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return null;
  if (!("state" in part)) return null;
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length);
  const label = TOOL_LABELS[name] ?? name;
  if (name === "propose_run" && part.state !== "output-error") {
    const output = part.state === "output-available" ? part.output : undefined;
    return <ProposeRunPart output={output as ProposeRunResult | undefined} />;
  }
  if (part.state === "output-error") {
    return <p className="text-xs text-muted-foreground">{label}: it found nothing.</p>;
  }
  if (part.state !== "output-available") {
    return <p className="text-xs text-muted-foreground">{label}…</p>;
  }
  const output = part.output as { available?: boolean; screenedOut?: number } | null;
  if (output?.available === false) {
    return <p className="text-xs text-muted-foreground">Memory was unavailable.</p>;
  }
  const left = output?.screenedOut ?? 0;
  return (
    <p className="text-xs text-muted-foreground">
      {label}
      {left === 0
        ? null
        : `. Left out ${String(left)} ${left === 1 ? "item" : "items"} that looked like instructions aimed at Mycel.`}
    </p>
  );
}

/** A fact's footnote numbers, with its markers. */
function Footnote({
  scope,
  numbers,
  citation,
}: {
  scope: string;
  numbers: number[];
  citation: Citation | undefined;
}) {
  if (citation === undefined) return null;
  return (
    <>
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
      {citation.disputed ? (
        <Badge
          variant="destructive"
          className="ml-1 align-middle"
          title="Someone outside the company says this, and it conflicts with what the company said."
        >
          Disputed
        </Badge>
      ) : citation.outsideOnly ? (
        <Badge
          variant="outline"
          className="ml-1 align-middle"
          title="Only someone outside the company says this."
        >
          Only from outside
        </Badge>
      ) : null}
    </>
  );
}

function textOf(message: AgentUIMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}
