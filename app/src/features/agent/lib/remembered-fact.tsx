// What a `remember` call shows in the chat. The chat streams, and keeps, only what the tool
// stores (the IDs of what was saved, or why nothing was), so it says that a fact was saved and
// who can see it, or plainly why nothing was; the reply's text says what was saved about whom.
import { BookmarkCheck } from "lucide-react";
import { TELL_REFUSAL_MESSAGES, TELL_REFUSALS, type TellRefusal } from "@/features/memory/types";

const isRefusal = (reason: unknown): reason is TellRefusal =>
  TELL_REFUSALS.some((known) => known === reason);

export function RememberedFact({ output }: { output: unknown }) {
  const result = (output ?? {}) as { saved?: boolean; reason?: unknown };
  if (result.saved !== true) {
    const why = isRefusal(result.reason) ? ` ${TELL_REFUSAL_MESSAGES[result.reason]}` : "";
    return <p className="text-xs text-muted-foreground">Not saved.{why}</p>;
  }
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <BookmarkCheck aria-hidden className="size-3.5" />
      Saved for you. Only you can see it.
    </p>
  );
}
