"use client";

// PROTOTYPE, throwaway: Ask Mycel as an answer beside its sources. The thread carries clean
// prose with no footnotes; a pane on the right lists what the selected reply drew on, and the
// sentence and its fact light up together under the pointer. Conversations live in a picker.
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { viewerFor } from "../_shared/fixtures";
import { PrototypeHeader } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { DISCLOSURE } from "./conversation";
import { SourcesPane } from "./b-pane";
import { ReplyB } from "./b-reply";
import { useAskChat, type AskChat } from "./use-ask-chat";

export function VariantB({ params }: VariantProps) {
  const chat = useAskChat(params.google);
  const [selectedId, setSelectedId] = useState<string | null>("2");
  const [hover, setHover] = useState<string | null>(null);
  const selected = chat.messages.find((m) => m.id === selectedId && m.role === "mycel");
  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col">
      <div className="border-b px-4 py-3">
        <PrototypeHeader title="Ask Mycel" admin={params.as === "admin"} />
      </div>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            chat={chat}
            onSwitch={() => {
              setSelectedId(null);
            }}
          />
          <Thread
            chat={chat}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            hover={hover}
            onHover={setHover}
          />
          <Composer chat={chat} />
        </section>
        <SourcesPane
          message={selected}
          hover={hover}
          onHover={setHover}
          connection={viewerFor(params.as).email}
        />
      </div>
    </div>
  );
}

function Toolbar({ chat, onSwitch }: { chat: AskChat; onSwitch: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <label htmlFor="conversation-picker" className="text-sm text-muted-foreground">
        Conversation
      </label>
      <select
        id="conversation-picker"
        value={chat.activeId ?? ""}
        onChange={(event) => {
          chat.setActiveId(event.target.value);
          onSwitch();
        }}
        className="h-8 max-w-72 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
      >
        {chat.conversations.length === 0 ? <option value="">No conversations yet</option> : null}
        {chat.conversations.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          chat.newConversation();
          onSwitch();
        }}
      >
        <Plus /> New
      </Button>
      {chat.activeId === null ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (chat.activeId !== null) chat.deleteConversation(chat.activeId);
            onSwitch();
          }}
        >
          <Trash2 /> Delete this conversation
        </Button>
      )}
      <span className="ml-auto text-xs text-muted-foreground">Only you can see it</span>
    </div>
  );
}

function Thread({
  chat,
  selectedId,
  onSelect,
  hover,
  onHover,
}: {
  chat: AskChat;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hover: string | null;
  onHover: (factId: string | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat.messages.length, chat.activeId, chat.streamProgress]);
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-6">
        <p className="text-xs text-muted-foreground">{DISCLOSURE}</p>
        {chat.googleConnected ? null : (
          <p role="status" className="border-l-2 pl-3 text-sm">
            No Google connection: answers come from company-wide memory only, and Mycel can&apos;t
            search your mail.{" "}
            <Link href="/connections" className="underline">
              Connect Google
            </Link>
          </p>
        )}
        {chat.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask about a customer, find a message in your mail, or tell Mycel something to remember.
          </p>
        ) : null}
        <ol className="flex flex-col gap-6" aria-label="Messages">
          {chat.messages.map((message) =>
            message.role === "person" ? (
              <li key={message.id} className="text-base font-medium">
                {message.parts.map((part) => (part.kind === "text" ? part.text : null))}
              </li>
            ) : (
              <li
                key={message.id}
                onMouseEnter={() => {
                  onSelect(message.id);
                }}
                className={cn(
                  "-ml-4 flex flex-col gap-2 border-l-2 py-1 pl-4 text-sm",
                  message.id === selectedId ? "border-foreground" : "border-transparent",
                )}
              >
                {message.parts.map((part, i) => (
                  <ReplyB
                    key={i}
                    part={part}
                    messageId={message.id}
                    chat={chat}
                    hover={hover}
                    onHover={onHover}
                  />
                ))}
                <button
                  type="button"
                  aria-pressed={message.id === selectedId}
                  onClick={() => {
                    onSelect(message.id);
                  }}
                  className="hidden self-start text-xs text-muted-foreground underline-offset-2 hover:underline lg:block"
                >
                  Show where this came from
                </button>
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}

function Composer({ chat }: { chat: AskChat }) {
  const [input, setInput] = useState("");
  return (
    <form
      className="flex items-center gap-2 border-t px-6 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        const text = input.trim();
        if (text === "" || chat.isStreaming) return;
        chat.send(text);
        setInput("");
      }}
    >
      <label htmlFor="ask-b" className="sr-only">
        Message to Mycel
      </label>
      <Input
        id="ask-b"
        value={input}
        placeholder="Ask Mycel…"
        onChange={(event) => {
          setInput(event.target.value);
        }}
      />
      <Button type="submit" disabled={chat.isStreaming || input.trim() === ""}>
        {chat.isStreaming ? "Answering…" : "Ask"}
      </Button>
    </form>
  );
}
