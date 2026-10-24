// What a `remember` call shows in the chat. The chat streams, and keeps, only what the tool
// stores (the IDs of what was saved, or why nothing was), so it says that a fact was saved and
// who can see it, with a link to "What I've told Mycel", or plainly why nothing was; the reply's
// text says what was saved about whom.
import { BookmarkCheck } from "lucide-react";
import Link from "next/link";
import { TELL_REFUSAL_MESSAGES, TELL_REFUSALS, type TellRefusal } from "@/features/memory/types";
import { TOLD_FACTS_PATH } from "../types";

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
      Saved for you. Only you can see it.{" "}
      <Link href={TOLD_FACTS_PATH} className="underline underline-offset-2 hover:text-foreground">
        What I&apos;ve told Mycel
      </Link>
    </p>
  );
}
