// What a fake Gmail mailbox holds beyond its messages, and the writes that change it:
// users.labels.create, users.messages.modify, and users.drafts.create, update, send and delete,
// in the shapes Google documents. Sending a draft removes it and adds a sent message, with a new
// ID, to its thread. A draft is kept as Gmail keeps it: a message labelled DRAFT in its thread, built
// from the RFC 2822 `raw` the request sent, so a test can read its headers and text.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import { z } from "zod";

/** A users.labels resource. */
export type FakeLabel = { id: string; name: string; type: "system" | "user" };

const SYSTEM_LABELS = [
  "INBOX",
  "SENT",
  "DRAFT",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SPAM",
  "TRASH",
  "CATEGORY_PERSONAL",
].map((id): FakeLabel => ({ id, name: id, type: "system" }));

/** A draft as a test reads it: where it is, its headers by lowercased name, and its text. */
export type FakeDraft = {
  id: string;
  messageId: string;
  threadId: string;
  headers: Record<string, string>;
  text: string;
};

/** The label and draft state of one mailbox, with a log of the writes it was asked for. */
export class FakeGmailWrites {
  private userLabels: FakeLabel[] = [];
  readonly drafts: FakeDraft[] = [];
  /** Every draft sent (by drafts.send, or from Gmail), as sent: its new message ID and all. */
  readonly sent: FakeDraft[] = [];
  /**
   * Every write asked for, in order: `labels.create`, `messages.modify`, `drafts.create`,
   * `drafts.update`, `drafts.send`, `drafts.delete`.
   */
  readonly log: string[] = [];
  private answersToLose = 0;

  labels(): FakeLabel[] {
    return [...SYSTEM_LABELS, ...this.userLabels];
  }

  /** The labels a user (or Mycel) made, as `{ id, name }`. */
  madeLabels(): { id: string; name: string }[] {
    return this.userLabels.map(({ id, name }) => ({ id, name }));
  }

  /**
   * The next write is made, but answered 503, as when Gmail made it and the answer was lost on
   * the way back: whoever tries again finds it already done.
   */
  loseNextAnswer(): void {
    this.answersToLose += 1;
  }

  takeLostAnswer(): boolean {
    if (this.answersToLose === 0) return false;
    this.answersToLose -= 1;
    return true;
  }

  /** labels.create. Undefined when a label of that name exists (Gmail answers 409). */
  createLabel(name: string): FakeLabel | undefined {
    const taken = this.labels().some((l) => l.name.toLowerCase() === name.toLowerCase());
    if (taken) return undefined;
    const label: FakeLabel = {
      id: `Label_${String(this.userLabels.length + 1)}`,
      name,
      type: "user",
    };
    this.userLabels.push(label);
    return label;
  }

  hasLabel(id: string): boolean {
    return this.labels().some((label) => label.id === id);
  }
}

/** What a mailbox lets a write change: its messages' labels, and its threads' drafts. */
export type WritableMailbox = {
  writes: FakeGmailWrites;
  modify(messageId: string, add: string[], remove: string[]): Record<string, unknown> | undefined;
  addDraft(threadId: string, draft: DraftContent): FakeDraft | undefined;
  updateDraft(id: string, draft: DraftContent): FakeDraft | undefined;
  sendDraft(id: string): FakeDraft | undefined;
  deleteDraft(id: string): boolean;
};

/** What a draft says: its headers and text. */
export type DraftContent = Omit<FakeDraft, "id" | "messageId" | "threadId">;

const labelCreate = z.object({ name: z.string().min(1) });
const modify = z.object({
  addLabelIds: z.array(z.string()).max(100).default([]),
  removeLabelIds: z.array(z.string()).max(100).default([]),
});
const draftCreate = z.object({
  message: z.object({ raw: z.string().min(1), threadId: z.string() }),
});
const draftUpdate = z.object({
  message: z.object({ raw: z.string().min(1), threadId: z.string().optional() }),
});
const draftSend = z.object({ id: z.string().min(1) });

const GMAIL = "/gmail/v1/users/me";

/** A write to the Gmail API, answered from the mailbox (or 503 after it, if asked to lose it). */
export function gmailWrite(
  mailbox: WritableMailbox,
  path: string,
  body: unknown,
  method: "POST" | "PUT" | "DELETE" = "POST",
): Response {
  const answer =
    method === "POST" ? write(mailbox, path, body) : draftWrite(mailbox, path, body, method);
  if (answer.ok && mailbox.writes.takeLostAnswer()) {
    return HttpResponse.json({ error: { code: 503, status: "UNAVAILABLE" } }, { status: 503 });
  }
  return answer;
}

// drafts.update (PUT) and drafts.delete (DELETE) on one draft.
function draftWrite(
  mailbox: WritableMailbox,
  path: string,
  body: unknown,
  method: "PUT" | "DELETE",
): Response {
  const id = new RegExp(`^${GMAIL}/drafts/([^/]+)$`).exec(path)?.[1];
  if (id === undefined) throw new Error(`The fake Gmail takes no ${method} to ${path}`);
  if (method === "DELETE") {
    mailbox.writes.log.push("drafts.delete");
    const deleted = mailbox.deleteDraft(decodeURIComponent(id));
    return deleted ? new HttpResponse(null, { status: 204 }) : error(404, "NOT_FOUND");
  }
  mailbox.writes.log.push("drafts.update");
  const draft = mailbox.updateDraft(
    decodeURIComponent(id),
    parseRaw(draftUpdate.parse(body).message.raw),
  );
  return draft === undefined ? error(404, "NOT_FOUND") : HttpResponse.json(draftResource(draft));
}

function draftResource(draft: FakeDraft) {
  return {
    id: draft.id,
    message: { id: draft.messageId, threadId: draft.threadId, labelIds: ["DRAFT"] },
  };
}

function write(mailbox: WritableMailbox, path: string, body: unknown): Response {
  const { writes } = mailbox;
  if (path === `${GMAIL}/drafts/send`) {
    writes.log.push("drafts.send");
    const sent = mailbox.sendDraft(draftSend.parse(body).id);
    if (sent === undefined) return error(404, "NOT_FOUND");
    return HttpResponse.json({ id: sent.messageId, threadId: sent.threadId, labelIds: ["SENT"] });
  }
  if (path === `${GMAIL}/labels`) {
    writes.log.push("labels.create");
    const label = writes.createLabel(labelCreate.parse(body).name);
    if (label === undefined) return error(409, "ALREADY_EXISTS", "Label name exists or conflicts");
    return HttpResponse.json(label);
  }
  const modified = new RegExp(`^${GMAIL}/messages/([^/]+)/modify$`).exec(path)?.[1];
  if (modified !== undefined) {
    writes.log.push("messages.modify");
    const { addLabelIds, removeLabelIds } = modify.parse(body);
    if (![...addLabelIds, ...removeLabelIds].every((id) => writes.hasLabel(id))) {
      return error(400, "INVALID_ARGUMENT", "Invalid label");
    }
    const message = mailbox.modify(decodeURIComponent(modified), addLabelIds, removeLabelIds);
    return message === undefined ? error(404, "NOT_FOUND") : HttpResponse.json(message);
  }
  if (path === `${GMAIL}/drafts`) {
    writes.log.push("drafts.create");
    const { raw, threadId } = draftCreate.parse(body).message;
    const draft = mailbox.addDraft(threadId, parseRaw(raw));
    if (draft === undefined) return error(404, "NOT_FOUND");
    return HttpResponse.json(draftResource(draft));
  }
  throw new Error(`The fake Gmail takes no POST to ${path}`);
}

/** users.drafts.list: every draft, newest last, paged. Like Gmail's, it carries no headers. */
export function listDrafts(writes: FakeGmailWrites, params: URLSearchParams) {
  const pageSize = Math.min(Number(params.get("maxResults") ?? 100), 500);
  const offset = Number(params.get("pageToken") ?? 0);
  const page = writes.drafts.slice(offset, offset + pageSize);
  const next = offset + pageSize < writes.drafts.length ? String(offset + pageSize) : undefined;
  return {
    ...(page.length > 0
      ? {
          drafts: page.map((d) => ({
            id: d.id,
            message: { id: d.messageId, threadId: d.threadId },
          })),
        }
      : {}),
    ...(next === undefined ? {} : { nextPageToken: next }),
    resultSizeEstimate: writes.drafts.length,
  };
}

export function newDraftIds() {
  return {
    id: `r-${randomUUID().slice(0, 8)}`,
    messageId: randomUUID().replaceAll("-", "").slice(0, 16),
  };
}

// An RFC 2822 message, base64url-encoded: unfolded headers, a blank line, then the body, which
// may be base64 by its Content-Transfer-Encoding.
function parseRaw(raw: string): DraftContent {
  const message = Buffer.from(raw, "base64url").toString("utf8");
  const split = message.indexOf("\r\n\r\n");
  if (split < 0) throw new Error("A draft's raw message needs CRLF line ends and a blank line");
  const headers: Record<string, string> = {};
  for (const line of message
    .slice(0, split)
    .replace(/\r\n[ \t]+/g, " ")
    .split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) throw new Error(`Malformed header line in a draft: ${line}`);
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const body = message.slice(split + 4);
  const encoding = headers["content-transfer-encoding"] as string | undefined;
  const base64 = encoding?.toLowerCase() === "base64";
  return { headers, text: base64 ? Buffer.from(body, "base64").toString("utf8") : body };
}

function error(code: number, status: string, message = "Requested entity was not found.") {
  return HttpResponse.json({ error: { code, message, status } }, { status: code });
}
