"use client";

// PROTOTYPE, throwaway: Ask Mycel as a classic chat. Conversations in a left rail, the thread
// in the middle, each answer's sources as numbered footnotes under it, the composer at the foot.
import Link from "next/link";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PrototypeHeader } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { DISCLOSURE } from "./conversation";
import { PartA } from "./a-parts";
import { ago } from "./facts";
import { useAskChat, type AskChat } from "./use-ask-chat";

export function VariantA({ params }: VariantProps) {
  const chat = useAskChat(params.google);
  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col">
      <div className="border-b px-4 py-3">
        <PrototypeHeader title="Ask Mycel" admin={params.as === "admin"} />
      </div>
      <div className="flex min-h-0 flex-1">
        <Rail chat={chat} />
        <section className="flex min-w-0 flex-1 flex-col">
          <Thread chat={chat} />
          <Composer chat={chat} />
        </section>
      </div>
    </div>
  );
}

function Rail({ chat }: { chat: AskChat }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 md:flex">
      <Button variant="outline" onClick={chat.newConversation} className="justify-start">
        <Plus /> New conversation
      </Button>
      {chat.conversations.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5" aria-label="Conversations">
          {chat.conversations.map((c) => (
            <li key={c.id} className="group flex items-center rounded hover:bg-muted">
              <button
                type="button"
                aria-current={c.id === chat.activeId ? "page" : undefined}
                onClick={() => {
                  chat.setActiveId(c.id);
                }}
                className="flex min-w-0 flex-1 flex-col items-start rounded px-2 py-1.5 text-left aria-[current=page]:bg-muted"
              >
                <span
                  className={cn("w-full truncate text-sm", c.id === chat.activeId && "font-medium")}
                >
                  {c.title}
                </span>
                <span className="text-xs text-muted-foreground">{ago(c.updatedAt)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete “${c.title}”`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  chat.deleteConversation(c.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto px-2 text-xs text-muted-foreground">
        Only you can see these. Conversations idle for 90 days are deleted.
      </p>
    </aside>
  );
}

export function Thread({ chat }: { chat: AskChat }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat.messages.length, chat.activeId, chat.streamProgress]);
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
        <p className="mx-auto max-w-lg rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
          {DISCLOSURE}
        </p>
        {chat.googleConnected ? null : (
          <p
            role="status"
            className="mx-auto max-w-lg rounded-md bg-muted px-3 py-2 text-center text-xs"
          >
            You haven&apos;t connected Google, so Mycel answers from company-wide memory only and
            can&apos;t search your mail.{" "}
            <Link href="/connections" className="underline">
              Connect Google
            </Link>
          </p>
        )}
        {chat.active === null ? (
          <p className="text-center text-sm text-muted-foreground">
            Start a conversation: ask about a customer, find a message, or tell Mycel something to
            remember.
          </p>
        ) : null}
        <ol className="flex flex-col gap-5" aria-label="Messages">
          {chat.messages.map((message) =>
            message.role === "person" ? (
              <li
                key={message.id}
                className="max-w-[80%] self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
              >
                {message.parts.map((part) => (part.kind === "text" ? part.text : null))}
              </li>
            ) : (
              <li key={message.id} className="flex gap-3 text-sm">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"
                >
                  <Sparkles className="size-3.5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Mycel</span>
                  {message.parts.map((part, i) => (
                    <PartA key={i} part={part} messageId={message.id} chat={chat} />
                  ))}
                </div>
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}

export function Composer({ chat }: { chat: AskChat }) {
  const [input, setInput] = useState("");
  const submit = () => {
    const text = input.trim();
    if (text === "" || chat.isStreaming) return;
    chat.send(text);
    setInput("");
  };
  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          aria-label="Message to Mycel"
          value={input}
          rows={1}
          placeholder="Ask about a customer, find a message, or say “remember that…”"
          className="max-h-40 min-h-9 resize-none border-0 shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setInput(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" disabled={chat.isStreaming || input.trim() === ""}>
          {chat.isStreaming ? "Answering…" : "Send"}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Mycel is an AI and can be wrong. It never acts in your apps; a run it starts waits on
        Reviews.
      </p>
    </form>
  );
}
