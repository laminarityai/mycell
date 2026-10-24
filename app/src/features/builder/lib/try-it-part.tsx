"use client";

// Try it in the builder chat: the panel under the conversation, and the summary a try leaves in
// it. The panel's answer carries the summary message, which joins the chat's messages at once.
import Link from "next/link";
import { TryItPanel } from "@/features/runtime/ui";
import type { RecentMessages, TryItState } from "@/features/runtime/types";
import { tryInConversationAction } from "../actions";
import type { BuilderUIMessage, TryItSummary } from "../types";

/**
 * The panel's state: closed until the admin asks (so no inbox is read), or open with mail, or
 * with invites for a workflow that starts on one.
 */
export type ConversationTryIt = ({ open: false } | { open: true; sources: RecentMessages[] }) & {
  /** What the spec's trigger starts a run on; a message unless it says otherwise. */
  item?: "message" | "invite";
};

export function ConversationTryItPanel({
  conversationId,
  tryIt,
  onSummary,
}: {
  conversationId: string;
  tryIt: ConversationTryIt;
  onSummary: (message: BuilderUIMessage) => void;
}) {
  return (
    <section aria-label="Try it" className="flex flex-col gap-2 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Try it</h2>
      {tryIt.open ? (
        <TryItPanel
          sources={tryIt.sources}
          item={tryIt.item}
          fields={{ conversationId }}
          action={async (previous: TryItState, form: FormData) => {
            const next = await tryInConversationAction(previous, form);
            if (next.message !== undefined) onSummary(next.message);
            return next;
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          See what the working spec would do with one recent {tryIt.item ?? "message"}, writing
          nothing.{" "}
          <Link href={`/builder/${conversationId}?try=1`} className="underline">
            Choose {tryIt.item === "invite" ? "an invite" : "a message"}
          </Link>
        </p>
      )}
    </section>
  );
}

/** A try's summary in the conversation: what the agent was told, no content. */
export function TryItSummaryPart({ summary }: { summary: TryItSummary }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">Tried it on a message:</p>
      <ul className="list-disc pl-5">
        {summary.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      <p className="text-xs opacity-80">Cost ${summary.costUsd.toFixed(4)}</p>
    </div>
  );
}
