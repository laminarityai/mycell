// A fake Gmail mailbox, served through the fake Nango's proxy. It answers the Gmail API calls
// Mycel makes (users.getProfile, users.messages.list and get, users.history.list,
// users.threads.get, users.labels.list, users.drafts.list and get, and the writes in
// fake-gmail-writes.ts) in the shapes Google documents, from messages a test seeds. A test can
// also send or delete a draft, and trash or delete a message, itself, as the person would in
// Gmail.
import { HttpResponse } from "msw";
import {
  draftMessage,
  gmailMessage,
  messageIdOnly,
  type FakeMessageInput,
  type GmailMessage,
} from "./fake-gmail-messages";
import {
  FakeGmailWrites,
  gmailWrite,
  listDrafts,
  newDraftIds,
  type DraftContent,
  type FakeDraft,
  type WritableMailbox,
} from "./fake-gmail-writes";

export type { FakeMessageInput, GmailMessage };

type HistoryMessage = { id: string; threadId: string; labelIds: string[] };

/**
 * A users.history resource: one change to the mailbox. The fake records a message added,
 * deleted for good, or given labels (such as TRASH).
 */
type HistoryRecord = {
  id: string;
  messages: { id: string; threadId: string }[];
  messagesAdded?: { message: HistoryMessage }[];
  messagesDeleted?: { message: HistoryMessage }[];
  labelsAdded?: { message: HistoryMessage; labelIds: string[] }[];
};

// Each historyTypes value, and the field of a record that holds that kind of change.
const HISTORY_TYPES = {
  messageAdded: "messagesAdded",
  messageDeleted: "messagesDeleted",
  labelAdded: "labelsAdded",
} as const;

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

  /** The person moves the message to the trash: it keeps its ID, with the TRASH label. */
  trash(id: string): void {
    const message = this.messages.find((m) => m.id === id);
    if (message === undefined) throw new Error(`The fake mailbox has no message ${id}`);
    message.labelIds = [...message.labelIds.filter((label) => label !== "TRASH"), "TRASH"];
    const record = this.nextRecord(message);
    record.labelsAdded = [{ message: historyMessage(message), labelIds: ["TRASH"] }];
  }

  /** The person deletes the message for good: Gmail no longer has it. */
  delete(id: string): void {
    const message = this.messages.find((m) => m.id === id);
    if (message === undefined) throw new Error(`The fake mailbox has no message ${id}`);
    this.messages = this.messages.filter((m) => m !== message);
    const record = this.nextRecord(message);
    record.messagesDeleted = [{ message: historyMessage(message) }];
  }

  private nextRecord(message: GmailMessage): HistoryRecord {
    this.historyId += 1;
    const record = {
      id: String(this.historyId),
      messages: [{ id: message.id, threadId: message.threadId }],
    };
    this.history.push(record);
    return record;
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

  /**
   * users.messages.list: newest first, filtered by `q=after:<epoch seconds>`, paged. Like
   * Gmail, it leaves out spam and trash unless `includeSpamTrash=true`, and lists drafts.
   */
  list(params: URLSearchParams) {
    const after = /after:(\d+)/.exec(params.get("q") ?? "")?.[1];
    const spamTrash = params.get("includeSpamTrash") === "true";
    const matching = this.messages
      .filter((m) => spamTrash || !m.labelIds.some((l) => l === "SPAM" || l === "TRASH"))
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
   * users.history.list: the records after `startHistoryId` of the `historyTypes` asked for
   * (every type, if none), oldest first, paged. Throws HistoryExpiredError for a start Gmail no
   * longer keeps.
   */
  listHistory(params: URLSearchParams) {
    const start = Number(params.get("startHistoryId"));
    if (!Number.isInteger(start) || start <= 0) throw new Error("startHistoryId is required");
    if (start < this.oldestHistoryId) throw new HistoryExpiredError();
    const types = params.getAll("historyTypes");
    const unknown = types.find((type) => !(type in HISTORY_TYPES));
    if (unknown !== undefined) throw new Error(`The fake Gmail doesn't record ${unknown}`);
    const fields = (types.length === 0 ? Object.keys(HISTORY_TYPES) : types).map(
      (type) => HISTORY_TYPES[type as keyof typeof HISTORY_TYPES],
    );
    const after = this.history.filter(
      (record) =>
        Number(record.id) > start && fields.some((field) => (record[field]?.length ?? 0) > 0),
    );
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

  addDraft(threadId: string, content: DraftContent) {
    if (!this.messages.some((m) => m.threadId === threadId)) return undefined;
    const draft: FakeDraft = { ...newDraftIds(), threadId, ...content };
    this.writes.drafts.push(draft);
    this.draftMessages.push(draftMessage(draft, String(this.historyId)));
    return draft;
  }

  /** users.drafts.get: the draft and its message, in `format`. */
  draft(id: string, params: URLSearchParams) {
    const draft = this.writes.drafts.find((d) => d.id === id);
    const message = this.draftMessages.find((m) => m.id === draft?.messageId);
    if (draft === undefined || message === undefined) return undefined;
    return { id: draft.id, message: inFormat(message, params) };
  }

  /** drafts.update: the draft keeps its ID and thread, with a new message for its new content. */
  updateDraft(id: string, content: DraftContent) {
    const old = this.writes.drafts.find((d) => d.id === id);
    if (old === undefined) return undefined;
    const draft: FakeDraft = { ...content, id, threadId: old.threadId, ...messageIdOnly() };
    this.writes.drafts.splice(this.writes.drafts.indexOf(old), 1, draft);
    this.draftMessages = this.draftMessages.filter((m) => m.id !== old.messageId);
    this.draftMessages.push(draftMessage(draft, String(this.historyId)));
    return draft;
  }

  /**
   * drafts.send, or the person sending the draft from Gmail: the draft goes, and a sent message
   * with a new ID joins its thread.
   */
  sendDraft(id: string): FakeDraft | undefined {
    const draft = this.writes.drafts.find((d) => d.id === id);
    if (draft === undefined || !this.deleteDraft(id)) return undefined;
    const header = (name: string) => draft.headers[name] as string | undefined;
    const kept = ["In-Reply-To", "References", "X-Mycel-Draft"].flatMap((name) => {
      const value = header(name.toLowerCase());
      return value === undefined ? [] : [[name, value] as const];
    });
    const to = header("to");
    const message = this.add({
      from: this.emailAddress,
      to: to === undefined ? [] : [to],
      subject: header("subject"),
      text: draft.text,
      sent: true,
      at: new Date(),
      threadId: draft.threadId,
      headers: Object.fromEntries(kept),
    });
    const sent = { ...draft, messageId: message.id };
    this.writes.sent.push(sent);
    return sent;
  }

  /** drafts.delete, or the person deleting the draft in Gmail. False when there's no such draft. */
  deleteDraft(id: string): boolean {
    const draft = this.writes.drafts.find((d) => d.id === id);
    if (draft === undefined) return false;
    this.writes.drafts.splice(this.writes.drafts.indexOf(draft), 1);
    this.draftMessages = this.draftMessages.filter((m) => m.id !== draft.messageId);
    return true;
  }
}

function historyMessage(message: GmailMessage): HistoryMessage {
  return { id: message.id, threadId: message.threadId, labelIds: [...message.labelIds] };
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
  const draftId = /^\/gmail\/v1\/users\/me\/drafts\/([^/]+)$/.exec(path)?.[1];
  if (draftId !== undefined) {
    const draft = mailbox.draft(decodeURIComponent(draftId), params);
    return draft === undefined ? gmailError(404, "NOT_FOUND") : HttpResponse.json(draft);
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
