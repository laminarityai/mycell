"use client";

// PROTOTYPE, throwaway: variant C's message picker and run card. Found messages are a list to
// choose from (sender, subject and date only); a proposed run is a card whose steps fill in.
import Link from "next/link";
import { Check, Unplug } from "lucide-react";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { workflowById } from "../_shared/fixtures";
import { OUT_OF_CREDITS, REMOVED, type FoundMessage } from "./conversation";
import { STARTED_RUN_ID, type RunState } from "./use-ask-chat";

export function MessagePicker({
  name,
  messages,
  connection,
  onUse,
}: {
  name: string;
  messages: FoundMessage[];
  connection: string;
  onUse: (message: FoundMessage) => void;
}) {
  const [picked, setPicked] = useState(messages[0].id);
  const chosen = messages.find((m) => m.id === picked) ?? messages[0];
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <legend className="px-1 text-xs text-muted-foreground">
        In {connection}: sender, subject and date only
      </legend>
      {messages.map((m) => (
        <label
          key={m.id}
          className={cn(
            "grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted",
            m.id === picked && "bg-muted",
          )}
        >
          <input
            type="radio"
            name={name}
            checked={m.id === picked}
            onChange={() => {
              setPicked(m.id);
            }}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.subject}</span>
            <span className="block truncate text-xs text-muted-foreground">{m.from}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            <DateTime value={m.at} />
          </span>
        </label>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          onUse(chosen);
        }}
      >
        Run a workflow on this one
      </Button>
    </fieldset>
  );
}

const STEPS = ["You press Run", "The run works on it", "Its draft waits on Reviews"];

export function RunCard({
  workflowId,
  message,
  state,
  onRun,
  connection,
}: {
  workflowId: string;
  message: FoundMessage;
  state: RunState;
  onRun: () => void;
  connection: string;
}) {
  const workflow = workflowById(workflowId);
  const reached = state === "proposed" ? 0 : state === "started" ? 1 : 3;
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Run this workflow?</p>
          <p className="text-base font-semibold">{workflow?.name}</p>
          <p className="text-xs text-muted-foreground">
            {workflow?.apps.join(" and ")}, as you through {connection}
          </p>
        </div>
        {state === "proposed" ? (
          <Button onClick={onRun}>Run</Button>
        ) : (
          <Badge variant="secondary">{state === "started" ? "Run started" : "Run finished"}</Badge>
        )}
      </div>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2">
        <dt className="text-muted-foreground">From</dt>
        <dd>{message.from}</dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd>{message.subject}</dd>
        <dt className="text-muted-foreground">Received</dt>
        <dd>
          <DateTime value={message.at} />
        </dd>
      </dl>
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className={cn(
              "flex items-center gap-2 text-xs",
              i < reached ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                i < reached && "border-foreground bg-foreground text-background",
              )}
            >
              {i < reached ? <Check className="size-3" aria-hidden /> : String(i + 1)}
            </span>
            {step}
          </li>
        ))}
      </ol>
      {state === "proposed" ? (
        <p className="text-xs text-muted-foreground">
          Nothing starts until you press Run. Mycel never sends anything itself.
        </p>
      ) : (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/prototype/run?run=${STARTED_RUN_ID}`} className="underline">
            Open run {STARTED_RUN_ID}
          </Link>
          <Link href="/reviews" className="underline">
            Go to Reviews
          </Link>
        </p>
      )}
    </div>
  );
}

export function RemovedStub() {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Unplug className="size-4" aria-hidden /> {REMOVED}
    </p>
  );
}

export function CreditsCard() {
  return (
    <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">Out of credits</p>
      <p className="text-sm">{OUT_OF_CREDITS}</p>
    </div>
  );
}
