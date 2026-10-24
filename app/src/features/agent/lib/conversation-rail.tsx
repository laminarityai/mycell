"use client";

// Ask Mycel's conversation rail (variant A2 of the prototype): a slim header with New
// conversation as a pencil icon button, a search box, the person's conversations, most recently
// active first, each with a delete button, and a line saying only they can see them. Searching
// turns the list into the conversations whose title or messages hold the words, each with its
// match highlighted, and how many there are. The search lives in the address (`?q=`), so the
// server reads it, and a hit opens its conversation with the search still showing.
import { Search, SquarePen, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { DateTime } from "@/components/date-time";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteConversationAction, startConversationAction } from "../actions";
import type { AgentConversationSummary, MarkedText, RailList } from "../types";

// How long typing pauses before the search runs.
const SEARCH_DELAY_MS = 200;

export function ConversationRail({ list, activeId }: { list: RailList; activeId?: string }) {
  const [started, start, starting] = useActionState(startConversationAction, {});
  const [searching, startSearch] = useTransition();
  const query = list.query ?? "";
  return (
    <aside
      className="flex w-full shrink-0 flex-col border-r bg-muted/15 md:w-56"
      aria-label="Ask Mycel conversations"
    >
      <div className="flex h-12 items-center justify-between border-b pr-2 pl-4">
        <p className="text-sm font-semibold">Ask Mycel</p>
        <form action={start}>
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            title="New conversation"
            disabled={starting}
          >
            <SquarePen />
          </Button>
        </form>
      </div>
      <div className="px-2">
        <FormError message={started.error} />
      </div>
      <SearchBox
        // A conversation opened or started starts from its address's search.
        key={activeId ?? ""}
        query={query}
        base={activeId === undefined ? "/ask" : `/ask/${activeId}`}
        startSearch={startSearch}
      />
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto px-2 pb-2", searching && "opacity-60")}
        aria-busy={searching}
      >
        {list.query === null ? (
          list.conversations.length === 0 ? (
            <p className="px-2 pt-2 text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="flex flex-col gap-px pt-1" aria-label="Conversations">
              {list.conversations.map((conversation) => (
                <Row key={conversation.id} conversation={conversation} activeId={activeId} />
              ))}
            </ul>
          )
        ) : (
          <>
            <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground" role="status">
              {list.hits.length === 0
                ? "No conversations match"
                : `${String(list.hits.length)} ${list.hits.length === 1 ? "conversation" : "conversations"}`}
            </p>
            <ul className="flex flex-col gap-px pt-1" aria-label="Conversations">
              {list.hits.map((hit) => (
                <Row
                  key={hit.id}
                  conversation={hit}
                  activeId={activeId}
                  query={list.query}
                  titleMatch={hit.titleMatch}
                  snippet={hit.snippet}
                />
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Only you can see these.</p>
    </aside>
  );
}

/**
 * The search box. Typing searches once it pauses, replacing the address's `q` (so Back doesn't
 * step through every letter); Escape and the clear button clear it at once; `/` focuses it from
 * anywhere but a text field.
 */
function SearchBox({
  query,
  base,
  startSearch,
}: {
  query: string;
  base: string;
  startSearch: (search: () => void) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useSlashToFocus(box);
  // A search still waiting when the box goes (another conversation opened) never runs.
  useEffect(() => {
    const waiting = timer;
    return () => {
      clearTimeout(waiting.current);
    };
  }, []);

  function search(text: string, delay: number) {
    setValue(text);
    clearTimeout(timer.current);
    const href = text.trim() === "" ? base : `${base}?q=${encodeURIComponent(text.trim())}`;
    timer.current = setTimeout(() => {
      startSearch(() => {
        router.replace(href, { scroll: false });
      });
    }, delay);
  }

  return (
    <div className="relative px-2 pt-2 pb-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-4.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={box}
        type="search"
        aria-label="Search conversations"
        placeholder="Search chats"
        value={value}
        maxLength={200}
        className="h-8 bg-background pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => {
          search(event.target.value, SEARCH_DELAY_MS);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          search("", 0);
          event.currentTarget.blur();
        }}
      />
      {value === "" ? (
        <kbd className="pointer-events-none absolute top-1/2 right-4 mt-0.5 -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[0.7rem] text-muted-foreground">
          /
        </kbd>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          className="absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-muted-foreground"
          onClick={() => {
            search("", 0);
            box.current?.focus();
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function Row({
  conversation,
  activeId,
  query,
  titleMatch = null,
  snippet = null,
}: {
  conversation: AgentConversationSummary;
  activeId: string | undefined;
  /** The search that found it, which its link keeps. */
  query?: string;
  titleMatch?: MarkedText | null;
  snippet?: MarkedText | null;
}) {
  const [deleted, remove, removing] = useActionState(deleteConversationAction, {});
  const here = conversation.id === activeId;
  const title = conversation.title ?? "New conversation";
  const href = `/ask/${conversation.id}${query === undefined ? "" : `?q=${encodeURIComponent(query)}`}`;
  return (
    <li className="group relative">
      <Link
        href={href}
        aria-current={here ? "page" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 pr-8 hover:bg-muted",
          here && "bg-muted",
        )}
      >
        <span className={cn("w-full truncate text-sm", here && "font-medium")}>
          {titleMatch === null ? title : <Marked text={titleMatch} />}
        </span>
        {snippet === null ? (
          <span className="text-xs text-muted-foreground">
            <DateTime value={conversation.updatedAt} />
          </span>
        ) : (
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
            <Marked text={snippet} />
          </span>
        )}
      </Link>
      <form action={remove} className="absolute top-1.5 right-1.5">
        <input type="hidden" name="conversationId" value={conversation.id} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete “${title}”`}
          disabled={removing}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 />
        </Button>
      </form>
      <FormError message={deleted.error} />
    </li>
  );
}

/** Text with the words a search matched highlighted. */
function Marked({ text }: { text: MarkedText }) {
  return text.map((piece, index) =>
    piece.match ? (
      <mark
        key={index}
        className="rounded-[3px] bg-amber-200/70 px-px text-foreground dark:bg-amber-400/30"
      >
        {piece.text}
      </mark>
    ) : (
      <span key={index}>{piece.text}</span>
    ),
  );
}

/** Pressing / anywhere but in a text field focuses the search box. */
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
