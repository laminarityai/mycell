// A fake Gmail mailbox, served through the fake Nango's proxy. It answers the Gmail API calls
// Mycel makes (users.getProfile, users.messages.list and get, users.history.list,
// users.threads.get, users.labels.list, users.drafts.list, and the writes in
// fake-gmail-writes.ts) in the shapes Google documents, from messages a test seeds.
import { randomUUID } from "node:crypto";
import { HttpResponse } from "msw";
import {
  FakeGmailWrites,
  gmailWrite,
  listDrafts,
  newDraftIds,
  type FakeDraft,
  type WritableMailbox,
} from "./fake-gmail-writes";

/** A message to seed, described the way a test thinks about it. */
export type FakeMessageInput = {
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; mimeType: string; size: number }[];
  // Sent from the mailbox (Gmail's SENT label) rather than received in its inbox.
  sent?: boolean;
  // Gmail's labels for it, when not the inbox's or SENT's defaults (["SPAM"], say).
  labelIds?: string[];
  at: Date;
  threadId?: string;
  // More headers, such as Reply-To or a reply's References.
  headers?: Record<string, string>;
};

type GmailPart = {
  partId: string;
  mimeType: string;
  filename: string;
  headers: { name: string; value: string }[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

/** A users.messages resource, as messages.get returns it with format=full. */
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: GmailPart;
  sizeEstimate: number;
};

/** A users.history resource: one change to the mailbox. The fake records messageAdded only. */
type HistoryRecord = {
  id: string;
  messages: { id: string; threadId: string }[];
  messagesAdded: { message: { id: string; threadId: string; labelIds: string[] } }[];
};

/** Thrown for a startHistoryId Gmail no longer keeps; the fake proxy answers it with 404. */
class HistoryExpiredError extends Error {}

export class FakeMailbox implements WritableMailbox {
  private historyId = 1000;
  private messages: GmailMessage[] = [];
  // Drafts' messages, in their threads but kept out of the message list and history.
  private draftMessages: GmailMessage[] = [];
  /** Its labels and drafts, and the writes it was asked for. */
  readonly writes = new FakeGmailWrites();
  private history: HistoryRecord[] = [];
  // History IDs below this one have expired: Gmail keeps history for about a week.
  private oldestHistoryId = 0;

  constructor(readonly emailAddress: string) {}

  /** Puts a message in the mailbox, as if it had just arrived (or been sent), and returns it. */
  add(input: FakeMessageInput): GmailMessage {
    this.historyId += 1;
    const message = gmailMessage(input, String(this.historyId));
    this.messages.push(message);
    const ref = { id: message.id, threadId: message.threadId };
    this.history.push({
      id: message.historyId,
      messages: [ref],
      messagesAdded: [{ message: { ...ref, labelIds: message.labelIds } }],
    });
    return message;
  }

  /** Gmail drops the history up to now, so a poll from any earlier history ID gets 404. */
  expireHistory(): void {
    this.history = [];
    this.oldestHistoryId = this.historyId;
  }

  profile() {
    return {
      emailAddress: this.emailAddress,
      messagesTotal: this.messages.length,
      threadsTotal: new Set(this.messages.map((m) => m.threadId)).size,
      historyId: String(this.historyId),
    };
  }

  /** users.messages.list: newest first, filtered by `q=after:<epoch seconds>`, paged. */
  list(params: URLSearchParams) {
    const after = /after:(\d+)/.exec(params.get("q") ?? "")?.[1];
    const matching = this.messages
      .filter((m) => after === undefined || Number(m.internalDate) > Number(after) * 1000)
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const pageSize = Math.min(Number(params.get("maxResults") ?? 100), 500);
    const offset = Number(params.get("pageToken") ?? 0);
    const page = matching.slice(offset, offset + pageSize);
    const next = offset + pageSize < matching.length ? String(offset + pageSize) : undefined;
    return {
      ...(page.length > 0
        ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) }
        : {}),
      ...(next === undefined ? {} : { nextPageToken: next }),
      resultSizeEstimate: matching.length,
    };
  }

  /**
   * users.history.list: the records after `startHistoryId`, oldest first, paged. Records
   * hold `messageAdded` changes only, so `historyTypes` filters nothing. Throws
   * HistoryExpiredError for a start Gmail no longer keeps.
   */
  listHistory(params: URLSearchParams) {
    const start = Number(params.get("startHistoryId"));
    if (!Number.isInteger(start) || start <= 0) throw new Error("startHistoryId is required");
    if (start < this.oldestHistoryId) throw new HistoryExpiredError();
    const types = params.getAll("historyTypes");
    if (types.some((type) => type !== "messageAdded")) {
      throw new Error("The fake Gmail records messageAdded history only");
    }
    const after = this.history.filter((record) => Number(record.id) > start);
    const pageSize = Math.min(Number(params.get("maxResults") ?? 100), 500);
    const offset = Number(params.get("pageToken") ?? 0);
    const page = after.slice(offset, offset + pageSize);
    const next = offset + pageSize < after.length ? String(offset + pageSize) : undefined;
    return {
      ...(page.length > 0 ? { history: page } : {}),
      ...(next === undefined ? {} : { nextPageToken: next }),
      historyId: String(this.historyId),
    };
  }

  get(id: string): GmailMessage | undefined {
    return [...this.messages, ...this.draftMessages].find((m) => m.id === id);
  }

  /** users.threads.get: the thread's messages and drafts, oldest first, in `format`. */
  thread(id: string, params: URLSearchParams) {
    const messages = [...this.messages, ...this.draftMessages]
      .filter((m) => m.threadId === id)
      .map((m) => inFormat(m, params));
    if (messages.length === 0) return undefined;
    return { id, historyId: String(this.historyId), messages };
  }

  /** The names of the labels on a message. */
  labelNamesOf(messageId: string): string[] {
    const labels = this.writes.labels();
    return (this.get(messageId)?.labelIds ?? []).map(
      (id) => labels.find((label) => label.id === id)?.name ?? id,
    );
  }

  /** The drafts in the mailbox, oldest first. */
  drafts(): FakeDraft[] {
    return [...this.writes.drafts];
  }

  modify(messageId: string, add: string[], remove: string[]) {
    const message = this.messages.find((m) => m.id === messageId);
    if (message === undefined) return undefined;
    message.labelIds = [
      ...message.labelIds.filter((id) => !remove.includes(id)),
      ...add.filter((id) => !message.labelIds.includes(id)),
    ];
    return minimal(message);
  }

  addDraft(threadId: string, content: Omit<FakeDraft, "id" | "messageId" | "threadId">) {
    if (!this.messages.some((m) => m.threadId === threadId)) return undefined;
    const draft: FakeDraft = { ...newDraftIds(), threadId, ...content };
    this.writes.drafts.push(draft);
    const headers = Object.entries(content.headers).map(([name, value]) => ({ name, value }));
    this.draftMessages.push({
      id: draft.messageId,
      threadId,
      labelIds: ["DRAFT"],
      snippet: content.text.slice(0, 100),
      historyId: String(this.historyId),
      internalDate: String(Date.now()),
      payload: { ...textPart("", "text/plain", content.text), headers },
      sizeEstimate: Buffer.byteLength(content.text),
    });
    return draft;
  }
}

function gmailMessage(input: FakeMessageInput, historyId: string): GmailMessage {
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const headers = [
    { name: "From", value: input.from },
    ...(input.to ? [{ name: "To", value: input.to.join(", ") }] : []),
    ...(input.cc ? [{ name: "Cc", value: input.cc.join(", ") }] : []),
    ...(input.bcc ? [{ name: "Bcc", value: input.bcc.join(", ") }] : []),
    { name: "Subject", value: input.subject ?? "" },
    { name: "Date", value: input.at.toUTCString() },
    { name: "Message-ID", value: `<${id}@mail.gmail.com>` },
    ...Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  const bodies: GmailPart[] = [
    ...(input.text === undefined ? [] : [textPart("0.0", "text/plain", input.text)]),
    ...(input.html === undefined ? [] : [textPart("0.1", "text/html", input.html)]),
  ];
  const attachments: GmailPart[] = (input.attachments ?? []).map((attachment, i) => ({
    partId: String(i + 1),
    mimeType: attachment.mimeType,
    filename: attachment.filename,
    headers: [
      { name: "Content-Type", value: `${attachment.mimeType}; name="${attachment.filename}"` },
      { name: "Content-Disposition", value: `attachment; filename="${attachment.filename}"` },
    ],
    body: { size: attachment.size, attachmentId: `ANGjdJ_${randomUUID()}` },
  }));
  return {
    id,
    threadId: input.threadId ?? id,
    labelIds:
      input.labelIds ?? (input.sent === true ? ["SENT"] : ["INBOX", "UNREAD", "CATEGORY_PERSONAL"]),
    snippet: (input.text ?? "").slice(0, 100),
    historyId,
    internalDate: String(input.at.getTime()),
    payload: {
      partId: "",
      mimeType: "multipart/mixed",
      filename: "",
      headers,
      body: { size: 0 },
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          filename: "",
          headers: [],
          body: { size: 0 },
          parts: bodies,
        },
        ...attachments,
      ],
    },
    sizeEstimate: 1024 + (input.attachments ?? []).reduce((sum, a) => sum + a.size, 0),
  };
}

function textPart(partId: string, mimeType: string, content: string): GmailPart {
  const data = Buffer.from(content, "utf8").toString("base64url");
  return {
    partId,
    mimeType,
    filename: "",
    headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
    body: { size: Buffer.byteLength(content), data },
  };
}

// The Gmail API behind the proxy, answering from the connection's mailbox.
export function gmailResponse(mailbox: FakeMailbox, path: string, params: URLSearchParams) {
  if (path === "/gmail/v1/users/me/profile") return HttpResponse.json(mailbox.profile());
  if (path === "/gmail/v1/users/me/messages") return HttpResponse.json(mailbox.list(params));
  if (path === "/gmail/v1/users/me/history") {
    try {
      return HttpResponse.json(mailbox.listHistory(params));
    } catch (error) {
      if (error instanceof HistoryExpiredError) return gmailError(404, "NOT_FOUND");
      throw error;
    }
  }
  if (path === "/gmail/v1/users/me/labels") {
    return HttpResponse.json({ labels: mailbox.writes.labels() });
  }
  if (path === "/gmail/v1/users/me/drafts") {
    return HttpResponse.json(listDrafts(mailbox.writes, params));
  }
  const threadId = /^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/.exec(path)?.[1];
  if (threadId !== undefined) {
    const thread = mailbox.thread(decodeURIComponent(threadId), params);
    return thread === undefined ? gmailError(404, "NOT_FOUND") : HttpResponse.json(thread);
  }
  const id = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(path)?.[1];
  if (id === undefined) throw new Error(`The fake Gmail doesn't serve ${path}`);
  const message = mailbox.get(decodeURIComponent(id));
  if (message === undefined) return gmailError(404, "NOT_FOUND");
  return HttpResponse.json(inFormat(message, params));
}

/** A POST to the Gmail API: a label, a label change, or a draft. */
export { gmailWrite };

// A message in the `format` asked for: full, metadata (only the `metadataHeaders` asked for,
// or all), or minimal (IDs and labels).
function inFormat(message: GmailMessage, params: URLSearchParams) {
  const format = params.get("format");
  if (format === "full") return message;
  if (format === "minimal") return minimal(message);
  if (format !== "metadata") throw new Error("The fake Gmail serves full, metadata and minimal");
  const asked = params.getAll("metadataHeaders").map((name) => name.toLowerCase());
  const headers = message.payload.headers.filter(
    (h) => asked.length === 0 || asked.includes(h.name.toLowerCase()),
  );
  return { ...minimal(message), payload: { mimeType: message.payload.mimeType, headers } };
}

// A message with format=minimal: its IDs and labels, no headers or body.
function minimal(message: GmailMessage) {
  const { id, threadId, labelIds, snippet, historyId, internalDate, sizeEstimate } = message;
  return { id, threadId, labelIds, snippet, historyId, internalDate, sizeEstimate };
}

// An error as Google's APIs return it.
export function gmailError(code: 404 | 429, status: string) {
  const message = code === 404 ? "Requested entity was not found." : "User-rate limit exceeded.";
  return HttpResponse.json({ error: { code, message, status } }, { status: code });
}
