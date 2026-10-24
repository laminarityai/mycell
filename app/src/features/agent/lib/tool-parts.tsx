// One tool call in a reply, as the chat shows it: what Mycel looked at, and for the mail and work
// tools what it found, from `FoundItems` (read again when the page loads, so a turn shows them
// once it ends). Mail is linked in the person's own Gmail, reviews on the Reviews page, and
// workflows on the Workflows page. With no Google connection, it says so with a way to connect.
import { Unplug } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import type { ReviewKind } from "@/features/reviews/types";
import type { FoundItems } from "../types";

const TOOL_LABELS: Record<string, string> = {
  search_memory: "Searched memory",
  read_object: "Read memory",
  find_messages: "Searched your mail",
  list_reviews: "Looked at your reviews",
  list_workflows: "Looked at your workflows",
};

const UNAVAILABLE: Record<string, string> = {
  find_messages: "Message search was unavailable.",
  list_reviews: "Your reviews were unavailable.",
  list_workflows: "Your workflows were unavailable.",
};

const KIND_LABELS: Record<ReviewKind, string> = {
  approval: "approval",
  escalation: "escalation",
  held_send: "held send",
};

/** A tool call: its name, how it stands, and what the conversation stored of its result. */
export type ToolCall = {
  name: string;
  state: "pending" | "failed" | "done";
  output?: unknown;
};

type MessageRefs = { connectionId: string; sourceRef: string }[];

type Stored = {
  available?: boolean;
  connected?: boolean;
  screenedOut?: number;
  messages?: MessageRefs;
  reviewIds?: string[];
  workflowIds?: string[];
};

const note = "text-xs text-muted-foreground";

export function ToolPart({ call, found }: { call: ToolCall; found: FoundItems }) {
  const label = TOOL_LABELS[call.name] ?? call.name;
  if (call.state === "failed") return <p className={note}>{label}: it found nothing.</p>;
  if (call.state === "pending") return <p className={note}>{label}…</p>;
  const output = (call.output ?? {}) as Stored;
  if (output.available === false) {
    return <p className={note}>{UNAVAILABLE[call.name] ?? "Memory was unavailable."}</p>;
  }
  if (output.connected === false) return <NoConnection />;
  const left = output.screenedOut ?? 0;
  return (
    <div className="flex flex-col gap-1">
      <p className={note}>
        {label}
        {left === 0
          ? null
          : `. Left out ${String(left)} ${left === 1 ? "item" : "items"} that looked like instructions aimed at Mycel.`}
      </p>
      {output.messages === undefined ? null : <Messages refs={output.messages} found={found} />}
      {output.reviewIds === undefined ? null : <Reviews ids={output.reviewIds} found={found} />}
      {output.workflowIds === undefined ? null : (
        <Workflows ids={output.workflowIds} found={found} />
      )}
    </div>
  );
}

function NoConnection() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Unplug className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Message search needs your Google connection. Until you connect it, Mycel answers from memory
        only.{" "}
        <Link href="/connections" className="text-foreground underline">
          Connect Google
        </Link>
      </span>
    </p>
  );
}

function Messages({ refs, found }: { refs: MessageRefs; found: FoundItems }) {
  const shown = found.messages.filter((message) =>
    refs.some(
      (ref) => ref.connectionId === message.connectionId && ref.sourceRef === message.sourceRef,
    ),
  );
  if (refs.length === 0) return <p className={note}>It found no messages.</p>;
  if (shown.length === 0) return <p className={note}>They&apos;re no longer in your mail.</p>;
  return (
    <ul className="ml-4 list-disc space-y-1" aria-label="Messages found">
      {shown.map((message) => (
        <li key={`${message.connectionId}:${message.sourceRef}`}>
          <a href={message.href} target="_blank" rel="noreferrer" className="underline">
            {message.subject === "" ? "(no subject)" : message.subject}
          </a>{" "}
          <span className="text-muted-foreground">
            from {message.from}, <DateTime value={message.receivedAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Reviews({ ids, found }: { ids: string[]; found: FoundItems }) {
  const shown = found.reviews.filter((review) => ids.includes(review.id));
  if (ids.length === 0) return <p className={note}>Nothing is waiting for you.</p>;
  if (shown.length === 0) return <p className={note}>None of them is waiting any more.</p>;
  return (
    <ul className="ml-4 list-disc space-y-1" aria-label="Reviews waiting">
      {shown.map((review) => (
        <li key={review.id}>
          <Link href={review.href} className="underline">
            {review.workflowName}
          </Link>{" "}
          <span className="text-muted-foreground">
            ({KIND_LABELS[review.kind]}, waiting since <DateTime value={review.createdAt} day />)
          </span>
        </li>
      ))}
    </ul>
  );
}

function Workflows({ ids, found }: { ids: string[]; found: FoundItems }) {
  const shown = found.workflows.filter((workflow) => ids.includes(workflow.id));
  if (ids.length === 0) return <p className={note}>You haven&apos;t switched any workflows on.</p>;
  if (shown.length === 0) return <p className={note}>None of them is switched on any more.</p>;
  return (
    <ul className="ml-4 list-disc space-y-1" aria-label="Workflows switched on">
      {shown.map((workflow) => (
        <li key={workflow.id}>
          <Link href="/workflows" className="font-medium underline">
            {workflow.name}
          </Link>
          {workflow.paused === null ? (
            <span className="text-muted-foreground">: on</span>
          ) : (
            <span className="text-destructive">: paused, {workflow.paused}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
