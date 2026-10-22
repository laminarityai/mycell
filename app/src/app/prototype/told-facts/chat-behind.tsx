"use client";

// PROTOTYPE, throwaway: a simplified Ask Mycel chat for variant C to open its drawer over: the
// script's first turns, up to the "remember that…" whose reply links to the drawer.
import { Textarea } from "@/components/ui/textarea";
import { SCRIPT, type Part } from "../ask/conversation";

const TURNS = SCRIPT.slice(0, 6);

export function ChatBehind({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <ol className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 text-sm">
        {TURNS.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "person"
                ? "max-w-[80%] self-end rounded-2xl bg-primary px-3.5 py-2 text-primary-foreground"
                : "flex flex-col gap-1"
            }
          >
            {message.parts.map((part, i) => (
              <Simple key={i} part={part} onOpenDrawer={onOpenDrawer} />
            ))}
          </li>
        ))}
      </ol>
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">
        <Textarea aria-label="Message to Mycel" rows={1} placeholder="Ask Mycel…" />
      </div>
    </div>
  );
}

function Simple({ part, onOpenDrawer }: { part: Part; onOpenDrawer: () => void }) {
  switch (part.kind) {
    case "text":
    case "unknown":
      return <p>{part.text}</p>;
    case "answer":
      return <p>{part.lines.map((l) => l.text).join(" ")}</p>;
    case "remembered":
      return (
        <p>
          Saved about {part.about.name}: &ldquo;{part.statement}&rdquo; Only you see it.{" "}
          <button type="button" className="underline" onClick={onOpenDrawer}>
            What I&apos;ve told Mycel
          </button>
        </p>
      );
    case "screened":
      return <p className="text-xs text-muted-foreground">{part.text}</p>;
    default:
      return null;
  }
}
