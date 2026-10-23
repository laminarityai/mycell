import Link from "next/link";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import { BuilderChat } from "./lib/builder-chat";
import { BuilderWorkspace, type WorkspaceWorkflow } from "./lib/builder-workspace";
import { toUIMessages } from "./lib/history";
import { NewConversationButton } from "./lib/new-conversation-button";
import type { ConversationWorkflow } from "./lib/proposal-part";
import type { ConversationTryIt } from "./lib/try-it-part";
import type { BuilderConversation, ConversationSummary, Proposal } from "./types";

export { NewConversationButton, type ConversationTryIt };

/** The org's builder conversations, the open one marked. */
export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ConversationSummary[];
  activeId?: string;
}) {
  if (conversations.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Conversations">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <Link
            href={`/builder/${conversation.id}`}
            aria-current={conversation.id === activeId ? "page" : undefined}
            className="block truncate rounded px-2 py-1 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium"
          >
            {conversation.title ?? "New conversation"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The conversation's workflow: its name and Publish state, and its working spec to draw. */
export type ConversationPageWorkflow = ConversationWorkflow & WorkspaceWorkflow;

/**
 * One conversation beside its workflow's graph: its stored messages, new turns as they stream
 * in, its proposals as cards (the waiting one drawn on the graph), and Publish once the
 * conversation's workflow has unpublished changes. Under 768px, Chat and Workflow tabs.
 */
export function Conversation({
  conversation,
  proposals,
  workflow,
  customActions,
  tryIt,
}: {
  conversation: BuilderConversation;
  proposals: Proposal[];
  /** The company's custom actions, for the graph to look actions up in. */
  customActions: CustomActionRecord[];
  workflow: ConversationPageWorkflow | null;
  /** Null until the conversation has a working spec to try. */
  tryIt: ConversationTryIt | null;
}) {
  return (
    <BuilderWorkspace
      // A new conversation gets a fresh chat and graph rather than the last one's state.
      key={conversation.id}
      proposals={proposals}
      workflow={workflow}
      customActions={customActions}
      chat={
        <BuilderChat
          conversationId={conversation.id}
          initialMessages={toUIMessages(conversation.messages)}
          summarizedThrough={conversation.summarizedThrough}
          proposals={proposals}
          workflow={workflow}
          tryIt={tryIt}
        />
      }
    />
  );
}
