// The digest email's words: how many reviews wait, then each workflow's count and how long its
// oldest has waited, oldest first, with links to the Reviews page and to turn the email off.
// Built from counts, workflow names and times only, never an item's text (invariant 8).
import type { Email } from "@/features/notifications/types";
import type { ReviewSummary } from "../types";

/** One workflow's line: its name, how many of its reviews wait, and since when. */
type WorkflowLine = { name: string; count: number; oldest: Date };

/**
 * The digest for one person, from their waiting reviews (oldest first, as `listReviews` gives
 * them), sent to `to`.
 */
export function digestEmail(input: {
  to: string;
  reviews: readonly ReviewSummary[];
  now: Date;
  reviewsUrl: string;
  unsubscribeUrl: string;
}): Email {
  const { reviews, now, reviewsUrl, unsubscribeUrl } = input;
  const headline = `${countOf(reviews.length)} waiting for you in Mycel`;
  const lines = byWorkflow(reviews).map((line) => lineText(line, now));
  const text = [
    `${headline}.`,
    "",
    ...lines,
    "",
    `Open your reviews: ${reviewsUrl}`,
    "",
    "You get this email on each day something is waiting for you.",
    `Turn it off: ${unsubscribeUrl}`,
  ].join("\n");
  const html = [
    `<p>${escape(headline)}.</p>`,
    `<ul>${lines.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>`,
    `<p><a href="${escape(reviewsUrl)}">Open your reviews</a></p>`,
    `<p>You get this email on each day something is waiting for you. ` +
      `<a href="${escape(unsubscribeUrl)}">Turn it off</a></p>`,
  ].join("\n");
  return {
    to: input.to,
    subject: headline,
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  };
}

// The reviews grouped by workflow, in the order of each one's oldest review.
function byWorkflow(reviews: readonly ReviewSummary[]): WorkflowLine[] {
  const lines = new Map<string, WorkflowLine>();
  for (const review of reviews) {
    const line = lines.get(review.workflowId);
    if (line === undefined) {
      lines.set(review.workflowId, {
        name: review.workflowName,
        count: 1,
        oldest: review.createdAt,
      });
    } else {
      line.count += 1;
      if (review.createdAt < line.oldest) line.oldest = review.createdAt;
    }
  }
  return [...lines.values()].sort((a, b) => a.oldest.getTime() - b.oldest.getTime());
}

function lineText({ name, count, oldest }: WorkflowLine, now: Date): string {
  const since = waited(oldest, now);
  return count === 1
    ? `${name}: 1 waiting, for ${since}`
    : `${name}: ${String(count)} waiting, the oldest for ${since}`;
}

function countOf(count: number): string {
  return count === 1 ? "1 review is" : `${String(count)} reviews are`;
}

function waited(since: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - since.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Workflow names are written by admins, so they're escaped like everything else in the HTML.
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
