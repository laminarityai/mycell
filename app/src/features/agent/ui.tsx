// Ask Mycel's page: the conversation rail beside the open conversation (variant A of the
// prototype: a classic chat with footnoted answers and the composer pinned below, with A2's
// search on the rail). With no conversation open, the rail beside a prompt to start one.
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ToldNotes } from "@/features/memory/types";
import { chatUIPart } from "@/features/models/server";
import { AskChat } from "./lib/ask-chat";
import { ConversationRail } from "./lib/conversation-rail";
import { ToldFilter } from "./lib/told-filter";
import { ToldTable } from "./lib/told-table";

// The told-facts table on its own: the rows, Delete and Undo, with no filter.
export { ToldTable };
import {
  TOLD_FACTS_PATH,
  type AgentConversation,
  type AgentUIMessage,
  type RailList,
} from "./types";

export function AskMycel({
  rail,
  conversation,
}: {
  /** The person's conversations, or what their search found. */
  rail: RailList;
  conversation: AgentConversation | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={conversation === null ? "flex min-h-0 md:contents" : "hidden md:contents"}>
        <ConversationRail list={rail} activeId={conversation?.id} />
      </div>
      {conversation === null ? (
        <div className="hidden flex-1 items-center justify-center p-6 md:flex">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Ask Mycel about your customers, suppliers, deals and policies. Start a conversation with
            the pencil button.
          </p>
        </div>
      ) : (
        <AskChat
          // A new conversation gets a fresh chat rather than the last one's state.
          key={conversation.id}
          conversationId={conversation.id}
          initialMessages={toUIMessages(conversation)}
          citations={conversation.citations}
          found={conversation.found}
        />
      )}
    </div>
  );
}

/** The chat header's link to "What I've told Mycel". */
export function ToldFactsLink() {
  return (
    <Link href={TOLD_FACTS_PATH} className="text-sm text-muted-foreground hover:text-foreground">
      What I&apos;ve told Mycel
    </Link>
  );
}

/**
 * "What I've told Mycel" (variant B2 of the prototype): everything the person told Mycel, in a
 * table they can filter and delete from, with a way back to the chat.
 */
export function ToldFacts({
  listed,
  words,
  includeOlder,
}: {
  listed: ToldNotes;
  words: string;
  includeOlder: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/ask"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Ask Mycel
        </Link>
        <p className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{listed.total}</Badge>
          {listed.total === 1 ? "note" : "notes"}
        </p>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Only you see these. Mycel uses them when you ask it something and when your own workflows
          look things up for your inbox. They&apos;re deleted if you leave the company.
        </p>
      </div>
      <ToldFilter words={words} includeOlder={includeOlder} />
      <ToldTable notes={listed.notes} total={listed.total} />
    </div>
  );
}

function toUIMessages(conversation: AgentConversation): AgentUIMessage[] {
  return conversation.messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) =>
      part.type === "removed" ? { type: "data-removed", data: {} } : chatUIPart(part),
    ),
  }));
}
