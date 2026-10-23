// The strip at the top of a run's page: how it ended, when, on whose inbox and which message,
// the version that ran and what it cost; and why it failed, when it failed as a whole. The
// message, with its link into Gmail, shows only to the inbox's readers (ADR-0001).
import { ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DateTime } from "@/components/date-time";
import type { RunMessage, RunRecord } from "../types";
import { FailureNote } from "./failure-note";
import { creditsText, inboxLabel, RunStatusLabel } from "./runs-table";

export function RunSummary({
  run,
  message,
  versionHref,
}: {
  run: RunRecord;
  /** The run's message, for a reader of its inbox; null otherwise. */
  message: RunMessage | null;
  /** Where the version that ran is shown, for those who may open it. */
  versionHref: string | null;
}) {
  const version =
    run.version === null ? "A deleted version" : `Version ${String(run.version.number)}`;
  return (
    <section aria-label="Run" className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-lg border px-4 py-3 text-sm">
        <Item label="Status">
          <RunStatusLabel status={run.status} />
        </Item>
        <Item label="Started">
          <DateTime value={run.startedAt} />
        </Item>
        <Item label="Inbox">{inboxLabel(run.inbox)}</Item>
        <Item label="Message">
          <MessageLink run={run} message={message} />
        </Item>
        <Item label="Version">
          {versionHref === null ? (
            version
          ) : (
            <Link href={versionHref} className="underline underline-offset-4">
              {version}
            </Link>
          )}
        </Item>
        <Item label="Credits">
          <span className="tabular-nums">{creditsText(run.costCredits)}</span>
        </Item>
      </dl>
      {run.errorCode === null ? null : <FailureNote code={run.errorCode} message={null} />}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function MessageLink({ run, message }: { run: RunRecord; message: RunMessage | null }) {
  if (!run.full) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Lock aria-hidden className="size-3.5 shrink-0" />
        Hidden: {inboxLabel(run.inbox)}&apos;s inbox
      </span>
    );
  }
  if (message?.subject == null || message.link === null) {
    return <span className="text-muted-foreground">Not available in Gmail</span>;
  }
  return (
    <a
      href={message.link}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-4"
    >
      {message.subject || "(no subject)"}
      <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}
