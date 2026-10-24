"use client";

// Ask Mycel's conversation rail: a slim header with New conversation as a pencil icon button,
// the person's conversations, most recently active first, each with a delete button, and a
// line saying only they can see them. Searching them is #180.
import { SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { DateTime } from "@/components/date-time";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteConversationAction, startConversationAction } from "../actions";
import type { AgentConversationSummary } from "../types";

export function ConversationRail({
  conversations,
  activeId,
}: {
  conversations: AgentConversationSummary[];
  activeId?: string;
}) {
  const [started, start, starting] = useActionState(startConversationAction, {});
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-px" aria-label="Conversations">
            {conversations.map((conversation) => (
              <Row key={conversation.id} conversation={conversation} activeId={activeId} />
            ))}
          </ul>
        )}
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Only you can see these.</p>
    </aside>
  );
}

function Row({
  conversation,
  activeId,
}: {
  conversation: AgentConversationSummary;
  activeId: string | undefined;
}) {
  const [deleted, remove, removing] = useActionState(deleteConversationAction, {});
  const here = conversation.id === activeId;
  const title = conversation.title ?? "New conversation";
  return (
    <li className="group relative">
      <Link
        href={`/ask/${conversation.id}`}
        aria-current={here ? "page" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 pr-8 hover:bg-muted",
          here && "bg-muted",
        )}
      >
        <span className={cn("w-full truncate text-sm", here && "font-medium")}>{title}</span>
        <span className="text-xs text-muted-foreground">
          <DateTime value={conversation.updatedAt} />
        </span>
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
