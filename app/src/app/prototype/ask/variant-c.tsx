"use client";

// PROTOTYPE, throwaway: Ask Mycel as structured turns. No bubbles and no rail: an ask bar on
// top, then turns newest first, each reply drawn as fact cards, a profile, a message picker or a
// run card instead of paragraphs. Past conversations open in a dialog.
import { History, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { viewerFor } from "../_shared/fixtures";
import { PrototypeHeader } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { DISCLOSURE, type Message, type Part } from "./conversation";
import { FactGrid, ProfileCard, RememberedCard, ScreenedChip, UnknownCard } from "./c-cards";
import { NoConnectionCard, RefusalCard, ReviewQueue, WorkflowTiles } from "./c-status";
import { CreditsCard, MessagePicker, RemovedStub, RunCard } from "./c-run";
import { ago } from "./facts";
import { useAskChat, type AskChat } from "./use-ask-chat";

const STARTERS = [
  "Tell me about ",
  "Find the message from ",
  "Remember that ",
  "What's waiting for me?",
];

export function VariantC({ params }: VariantProps) {
  const chat = useAskChat(params.google);
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const connection = viewerFor(params.as).email;
  const prefill = (text: string) => {
    setInput(text);
    field.current?.focus();
  };
  // Each question with the reply that answered it, newest first.
  const turns: { ask: Message; reply?: Message }[] = [];
  chat.messages.forEach((m) => {
    if (m.role === "person") turns.unshift({ ask: m });
    else if (turns.length > 0) turns[0].reply = m;
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <PrototypeHeader title="Ask Mycel" admin={params.as === "admin"} />
      <form
        className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (text === "" || chat.isStreaming) return;
          chat.send(text);
          setInput("");
        }}
      >
        <label htmlFor="ask-c" className="text-sm font-medium">
          What do you want to know, find or have Mycel remember?
        </label>
        <div className="flex gap-2">
          <Input
            id="ask-c"
            ref={field}
            value={input}
            className="h-10 bg-background text-base"
            placeholder="What did we agree with Northwind?"
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <Button type="submit" size="lg" disabled={chat.isStreaming || input.trim() === ""}>
            Ask
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STARTERS.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                prefill(s);
              }}
            >
              {s.trim()}…
            </Button>
          ))}
          <Conversations chat={chat} />
        </div>
        <p className="text-xs text-muted-foreground">{DISCLOSURE}</p>
        {chat.googleConnected ? null : (
          <p role="status" className="text-xs">
            Not connected to Google: Mycel answers from company-wide memory and can&apos;t find
            messages in your mail.
          </p>
        )}
      </form>

      {turns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          A new conversation. What you ask here stays between you and Mycel.
        </p>
      ) : null}
      <ol className="flex flex-col gap-8" aria-label="Turns">
        {turns.map(({ ask, reply }) => (
          <li key={ask.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 border-b pb-2">
              <h2 className="font-medium">
                {ask.parts.map((p) => (p.kind === "text" ? p.text : null))}
              </h2>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(ask.at)}</span>
            </div>
            {reply?.parts.map((part, i) => (
              <ReplyCard
                key={i}
                part={part}
                messageId={reply.id}
                chat={chat}
                connection={connection}
                onPrefill={prefill}
              />
            ))}
          </li>
        ))}
      </ol>
    </main>
  );
}

function ReplyCard({
  part,
  messageId,
  chat,
  connection,
  onPrefill,
}: {
  part: Part;
  messageId: string;
  chat: AskChat;
  connection: string;
  onPrefill: (text: string) => void;
}) {
  switch (part.kind) {
    case "text":
      return <p className="text-sm">{chat.shownText(messageId, part.text)}</p>;
    case "answer": {
      const ids = part.lines.flatMap((l) => (l.factId === undefined ? [] : [l.factId]));
      return ids.length === 0 ? (
        <p className="text-sm">{part.lines.map((l) => l.text).join(" ")}</p>
      ) : (
        <FactGrid factIds={ids} />
      );
    }
    case "summary":
      return <ProfileCard subject={part.subject} factIds={part.factIds} />;
    case "unknown":
      return (
        <UnknownCard
          text={part.text}
          onTell={() => {
            onPrefill("Remember that ");
          }}
        />
      );
    case "messages":
      return (
        <MessagePicker
          name={`pick-${messageId}`}
          messages={part.messages}
          connection={connection}
          onUse={(m) => {
            onPrefill(`Run Reply to quote requests on “${m.subject}”`);
          }}
        />
      );
    case "proposedRun":
      return (
        <RunCard
          workflowId={part.workflowId}
          message={part.message}
          state={chat.runState(messageId)}
          connection={connection}
          onRun={() => {
            chat.run(messageId);
          }}
        />
      );
    case "remembered":
      return <RememberedCard part={part} />;
    case "removed":
      return <RemovedStub />;
    case "outOfCredits":
      return <CreditsCard />;
    case "screened":
      return <ScreenedChip text={part.text} />;
    case "reviews":
      return <ReviewQueue reviews={part.reviews} />;
    case "workflows":
      return <WorkflowTiles workflowIds={part.workflowIds} />;
    case "refusal":
      return <RefusalCard part={part} />;
    case "noConnection":
      return <NoConnectionCard />;
  }
}

function Conversations({ chat }: { chat: AskChat }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="ml-auto">
          <History /> Conversations ({chat.conversations.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your conversations</DialogTitle>
          <DialogDescription>Only you can see these. Idle ones go after 90 days.</DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          onClick={() => {
            chat.newConversation();
            setOpen(false);
          }}
        >
          <Plus /> New conversation
        </Button>
        <ul className="flex flex-col divide-y">
          {chat.conversations.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  chat.setActiveId(c.id);
                  setOpen(false);
                }}
              >
                <span className={c.id === chat.activeId ? "font-medium" : undefined}>
                  {c.title}
                </span>
                <span className="block text-xs text-muted-foreground">{ago(c.updatedAt)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete “${c.title}”`}
                onClick={() => {
                  chat.deleteConversation(c.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
