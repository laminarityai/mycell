"use client";

// The streamed conversation: the stored messages, then each turn as it streams in. Only the
// admin's new message goes to the server, which holds the rest.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BuilderUIMessage } from "../types";

const TOOL_LABELS: Record<string, string> = {
  get_workflow: "Read a workflow",
};

export function BuilderChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: BuilderUIMessage[];
}) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<BuilderUIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/builder/turn",
      prepareSendMessagesRequest: ({ messages: all }) => ({
        body: { conversationId, message: textOf(all.at(-1)) },
      }),
    }),
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
              <MessagePart key={index} part={part} />
            ))}
          </li>
        ))}
      </ol>
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

function MessagePart({ part }: { part: BuilderUIMessage["parts"][number] }) {
  if (part.type === "text") return <p className="whitespace-pre-wrap">{part.text}</p>;
  if (part.type === "data-notice") {
    return (
      <p role="status" className="text-sm text-destructive">
        {part.data.text}
      </p>
    );
  }
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : undefined;
  if (toolName === undefined) return null;
  return <p className="text-xs text-muted-foreground">{TOOL_LABELS[toolName] ?? toolName}</p>;
}

function textOf(message: BuilderUIMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}
