// What an alert is: a notice telling admins something needs them, worked out from Mycel's
// current state and never stored, so it goes away by itself once its cause is fixed.
import type { ConnectionKind, Source } from "@/features/connections/types";

/**
 * Every kind of alert, most urgent first: the order the Alerts page lists them in. #176 adds
 * `workflow_failing` and `budget_reached`, each in its place.
 */
export const ALERT_KINDS = [
  "credits_out",
  "connection_reconnect",
  "backfill_failed",
  "credits_low",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * How much an alert's cause stops: `everything` (nothing runs), `one` (a workflow or an inbox,
 * the rest keeps running) or `later` (nothing has stopped yet, it can wait a day).
 */
export const ALERT_URGENCIES = ["everything", "one", "later"] as const;
export type AlertUrgency = (typeof ALERT_URGENCIES)[number];

export const ALERT_URGENCY: Record<AlertKind, AlertUrgency> = {
  credits_out: "everything",
  connection_reconnect: "one",
  backfill_failed: "later",
  credits_low: "later",
};

/**
 * What an alert is about: the company's credits, or one connection (the admin's own, or an org
 * connection). #176 adds a workflow.
 */
export type AlertSubject =
  | { type: "credits" }
  | {
      type: "connection";
      id: string;
      source: Source;
      kind: ConnectionKind;
      accountEmail: string;
    };

export type Alert = {
  /** Stable while its cause holds: the kind, and its subject's ID where it has one. */
  id: string;
  kind: AlertKind;
  subject: AlertSubject;
  /** When its cause began, where Mycel knows; null where it doesn't record it. */
  startedAt: Date | null;
  /** What happened, in a sentence or two. */
  sentence: string;
  /** What makes it go away by itself: "Once credits are granted." */
  clearsWhen: string;
  /** The one thing to do about it. */
  fix: { label: string; href: string };
};
