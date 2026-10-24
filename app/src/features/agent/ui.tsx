// Ask Mycel's page: the conversation rail beside the open conversation (variant A of the
// prototype: a classic chat with footnoted answers and the composer pinned below). With no
// conversation open, the rail beside a prompt to start one.
import { chatUIPart } from "@/features/models/server";
import { AskChat } from "./lib/ask-chat";
import { ConversationRail } from "./lib/conversation-rail";
import type { AgentConversation, AgentConversationSummary, AgentUIMessage } from "./types";

export function AskMycel({
  conversations,
  conversation,
}: {
  conversations: AgentConversationSummary[];
  conversation: AgentConversation | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={conversation === null ? "flex min-h-0 md:contents" : "hidden md:contents"}>
        <ConversationRail conversations={conversations} activeId={conversation?.id} />
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
