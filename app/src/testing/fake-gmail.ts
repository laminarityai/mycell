// A fake Gmail mailbox, served through the fake Nango's proxy. It answers the Gmail API calls
// Mycel makes (users.getProfile, users.messages.list, users.messages.get) in the shapes
// Google documents, from messages a test seeds.
import { randomUUID } from "node:crypto";

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
  at: Date;
  threadId?: string;
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

export class FakeMailbox {
  private historyId = 1000;
  private messages: GmailMessage[] = [];

  constructor(readonly emailAddress: string) {}

  /** Puts a message in the mailbox, as if it had just arrived (or been sent), and returns it. */
  add(input: FakeMessageInput): GmailMessage {
    this.historyId += 1;
    const message = gmailMessage(input, String(this.historyId));
    this.messages.push(message);
    return message;
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

  get(id: string): GmailMessage | undefined {
    return this.messages.find((m) => m.id === id);
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
    labelIds: input.sent === true ? ["SENT"] : ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
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
