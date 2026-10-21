"use client";

// The streamed conversation: the stored messages, then each turn as it streams in. Only the
// admin's new message goes to the server, which holds the rest.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BuilderUIMessage, Proposal, ProposeSpecResult } from "../types";
import { ProposeSpecPart, PublishBar, type ConversationWorkflow } from "./proposal-part";
import { ConversationTryItPanel, TryItSummaryPart, type ConversationTryIt } from "./try-it-part";

const TOOL_LABELS: Record<string, string> = {
  get_workflow: "Read a workflow",
  read_examples: "Read example messages",
};

/** Tools whose calls show more than their label. */
const PROPOSE_SPEC = "propose_spec";

export function BuilderChat({
  conversationId,
  initialMessages,
  proposals,
  workflow,
  tryIt,
}: {
  conversationId: string;
  initialMessages: BuilderUIMessage[];
  /** The conversation's proposals, as the server last read them. */
  proposals: Proposal[];
  workflow: ConversationWorkflow | null;
  /** Null until the conversation has a working spec to try. */
  tryIt: ConversationTryIt | null;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);
  const [input, setInput] = useState("");
  const { messages, setMessages, sendMessage, status, error } = useChat<BuilderUIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/builder/turn",
      prepareSendMessagesRequest: ({ messages: all }) => ({
        body: { conversationId, message: textOf(all.at(-1)) },
      }),
    }),
    // A turn may have stored proposals: read them again.
    onFinish: () => {
      router.refresh();
    },
  });
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3" aria-label="Messages">
        {messages.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            Describe the work you want a workflow to do, in your own words.
          </li>
        ) : null}
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "user"
                ? "self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                : "flex flex-col gap-1 text-sm"
            }
          >
            {message.parts.map((part, index) => (
              <MessagePart key={index} part={part} proposals={byId} />
            ))}
          </li>
        ))}
      </ol>
      {workflow === null ? null : <PublishBar workflow={workflow} />}
      {tryIt === null ? null : (
        <ConversationTryItPanel
          conversationId={conversationId}
          tryIt={tryIt}
          onSummary={(message) => {
            setMessages((current) => [...current, message]);
          }}
        />
      )}
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error.message || "The builder couldn't answer. Try again."}
        </p>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (text === "" || busy) return;
          void sendMessage({ text });
          setInput("");
        }}
      >
        <Textarea
          aria-label="Message"
          value={input}
          placeholder="Draft replies to pricing questions using our price sheet…"
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
        <Button type="submit" className="self-end" disabled={busy || input.trim() === ""}>
          {busy ? "Answering…" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function MessagePart({
  part,
  proposals,
}: {
  part: BuilderUIMessage["parts"][number];
  proposals: Map<string, Proposal>;
}) {
  if (part.type === "text") return <p className="whitespace-pre-wrap">{part.text}</p>;
  if (part.type === "data-notice") {
    return (
      <p role="status" className="text-sm text-destructive">
        {part.data.text}
      </p>
    );
  }
  if (part.type === "data-tryIt") return <TryItSummaryPart summary={part.data} />;
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : undefined;
  if (toolName === undefined) return null;
  if (toolName === PROPOSE_SPEC && "state" in part) {
    // The stored and streamed result is what `propose_spec` returned.
    const output =
      part.state === "output-available" ? (part.output as ProposeSpecResult) : undefined;
    if (part.state === "output-error") {
      return <p className="text-xs text-muted-foreground">Couldn&apos;t check a proposal.</p>;
    }
    return <ProposeSpecPart output={output} proposals={proposals} />;
  }
  return <p className="text-xs text-muted-foreground">{TOOL_LABELS[toolName] ?? toolName}</p>;
}

function textOf(message: BuilderUIMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}
