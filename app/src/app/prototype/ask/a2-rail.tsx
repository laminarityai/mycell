"use client";

// PROTOTYPE, throwaway: variant A2's conversation rail. A slim header with a new-conversation
// icon button, a search box that filters by title and by words in the messages (press / to
// focus it), and the list, which turns into search hits with a highlighted snippet each.
import { Search, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "./conversation";
import { ago } from "./facts";
import { searchConversations, splitOnMatch, type SearchHit } from "./a2-search";
import type { AskChat } from "./use-ask-chat";

export function RailA2({ chat }: { chat: AskChat }) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useSlashToFocus(box);
  const searching = query.trim() !== "";
  const hits: SearchHit[] = searching
    ? searchConversations(query, chat.conversations, chat.threads)
    : chat.conversations.map((conversation) => ({ conversation, titleMatch: false }));

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/15 md:flex">
      <div className="flex h-12 items-center justify-between border-b pr-2 pl-4">
        <p className="text-sm font-semibold">Ask Mycel</p>
        <Tip label="New conversation">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            onClick={() => {
              setQuery("");
              chat.newConversation();
            }}
          >
            <SquarePen />
          </Button>
        </Tip>
      </div>
      <div className="relative px-2 pt-2 pb-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-4.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={box}
          type="search"
          aria-label="Search conversations"
          value={query}
          placeholder="Search chats"
          className="h-8 bg-background pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        {searching ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            className="absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-muted-foreground"
            onClick={() => {
              setQuery("");
              box.current?.focus();
            }}
          >
            <X />
          </Button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-4 mt-0.5 -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[0.7rem] text-muted-foreground">
            /
          </kbd>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searching ? (
          <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground" role="status">
            {hits.length === 0
              ? "No conversations match"
              : `${String(hits.length)} ${hits.length === 1 ? "conversation" : "conversations"}`}
          </p>
        ) : null}
        {!searching && chat.conversations.length === 0 ? (
          <p className="px-2 pt-2 text-sm text-muted-foreground">No conversations yet.</p>
        ) : null}
        <ul className="flex flex-col gap-px pt-1" aria-label="Conversations">
          {hits.map((hit) => (
            <Row key={hit.conversation.id} hit={hit} query={query} chat={chat} />
          ))}
        </ul>
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Only you can see these. Conversations idle for 90 days are deleted.
      </p>
    </aside>
  );
}

function Row({ hit, query, chat }: { hit: SearchHit; query: string; chat: AskChat }) {
  const { conversation: c, snippet } = hit;
  const here = c.id === chat.activeId;
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={here ? "page" : undefined}
        onClick={() => {
          chat.setActiveId(c.id);
        }}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 pr-8 text-left hover:bg-muted",
          here && "bg-muted",
        )}
      >
        <span className={cn("w-full truncate text-sm", here && "font-medium")}>
          <Highlighted text={c.title} query={query} />
        </span>
        {snippet === undefined ? (
          <When conversation={c} />
        ) : (
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
            {snippet.before}
            <Mark>{snippet.match}</Mark>
            {snippet.after}
          </span>
        )}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete “${c.title}”`}
        className="absolute top-1.5 right-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          chat.deleteConversation(c.id);
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function When({ conversation }: { conversation: ConversationSummary }) {
  return <span className="text-xs text-muted-foreground">{ago(conversation.updatedAt)}</span>;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return splitOnMatch(text, query).map((piece, i) =>
    piece.hit ? <Mark key={i}>{piece.text}</Mark> : <span key={i}>{piece.text}</span>,
  );
}

function Mark({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-[3px] bg-amber-200/70 px-px text-foreground dark:bg-amber-400/30">
      {children}
    </mark>
  );
}

/** A label that shows above its control on hover and keyboard focus. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute top-full right-0 z-10 mt-1 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

/** Pressing / anywhere but in a field focuses the search box. */
function useSlashToFocus(box: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      box.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [box]);
}
