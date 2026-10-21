"use client";

// The "Try it" panel: pick one of the newest messages on the admin's own or an org connection,
// run the working spec on it with every write stubbed, and see each step's result. The page
// that holds it gives the Server Action (the workflow page's, or the builder chat's) and the
// hidden fields it needs. On a page with a workflow graph, the result lights it up too.
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useShowOnGraph } from "@/features/workflows/ui";
import type { RecentMessages, TryItState } from "../types";
import { TryItResult } from "./try-it-result";

export function TryItPanel({
  sources,
  action,
  fields,
}: {
  sources: RecentMessages[];
  action: (previous: TryItState, form: FormData) => Promise<TryItState>;
  /** Hidden form fields the action reads, such as the workflow's ID. */
  fields: Record<string, string>;
}) {
  const [state, tryIt, trying] = useActionState(action, {});
  const showOnGraph = useShowOnGraph();
  useEffect(() => {
    showOnGraph?.(state.result ?? null);
  }, [showOnGraph, state.result]);
  const first = sources
    .flatMap((source) => source.messages.slice(0, 1).map((message) => ({ source, message })))
    .at(0);
  const [picked, setPicked] = useState(
    first === undefined ? "" : key(first.source.connectionId, first.message.sourceRef),
  );
  const [connectionId = "", sourceRef = ""] = picked.split("/");

  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect your own Google account, or an org account, allowed Gmail to try it on a message.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <form action={tryIt} className="flex flex-col gap-3">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="connectionId" value={connectionId} />
        <input type="hidden" name="sourceRef" value={sourceRef} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Message
          <select
            value={picked}
            onChange={(event) => {
              setPicked(event.target.value);
            }}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {sources.map((source) => (
              <optgroup key={source.connectionId} label={source.accountEmail}>
                {source.unavailable ? (
                  <option disabled value="">
                    Couldn&apos;t read this inbox just now
                  </option>
                ) : null}
                {source.messages.map((message) => (
                  <option
                    key={message.sourceRef}
                    value={key(source.connectionId, message.sourceRef)}
                  >
                    {message.subject || "(no subject)"} · {message.from}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Model and read steps run for real and use credits. Nothing is written to Gmail, Sheets or
          any other app.
        </p>
        <div>
          <Button type="submit" disabled={trying || picked === ""}>
            {trying ? "Trying…" : "Try it"}
          </Button>
        </div>
      </form>
      {state.error === undefined ? null : (
        <div role="alert" className="text-sm text-destructive">
          <p>{state.error}</p>
          {state.issues === undefined ? null : (
            <ul className="list-disc pl-5">
              {state.issues.map((issue, index) => (
                <li key={index}>
                  <code className="font-mono text-xs">{issue.path.join(".")}</code>: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.result === undefined ? null : (
        <TryItResult result={state.result} onGraph={showOnGraph !== null} />
      )}
    </div>
  );
}

function key(connectionId: string, sourceRef: string): string {
  return `${connectionId}/${sourceRef}`;
}
