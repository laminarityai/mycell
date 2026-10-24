// Ask Mycel's page: the conversation rail beside the open conversation (variant A of the
// prototype: a classic chat with footnoted answers and the composer pinned below, with A2's
// search on the rail). With no conversation open, the rail beside a prompt to start one.
import { chatUIPart } from "@/features/models/server";
import { AskChat } from "./lib/ask-chat";
import { ConversationRail } from "./lib/conversation-rail";
import type { AgentConversation, AgentUIMessage, RailList } from "./types";

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

function toUIMessages(conversation: AgentConversation): AgentUIMessage[] {
  return conversation.messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map(chatUIPart),
  }));
}
