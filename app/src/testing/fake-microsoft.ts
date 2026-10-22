// The fake Microsoft Graph: the registered app the fake Nango proxies a `microsoft` connection to,
// on graph.microsoft.com. It records every request it receives, so a test can check exactly what
// was sent and how often, and answers who the signed-in user is (`GET /v1.0/me`), the messages
// of their Outlook mailbox that a test seeds (`GET /v1.0/me/messages/{id}`), and replies to them
// (`POST /v1.0/me/messages/{id}/reply`, which a test reads back from `requests`). Any other path
// is 404, as Graph answers a resource it doesn't have.
import { HttpResponse } from "msw";
import type { ProxyMethod } from "./fake-proxied-sources";

/** One request the fake app received through the proxy. */
export type FakeAppRequest = {
  method: ProxyMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
};

/** An Outlook message as a test seeds it. */
export type FakeOutlookMessage = {
  id: string;
  subject: string;
  from: string;
  body: string;
  isRead?: boolean;
};

const MESSAGE_PATH = /^\/v1\.0\/me\/messages\/([^/]+)$/;
const REPLY_PATH = /^\/v1\.0\/me\/messages\/([^/]+)\/reply$/;

export class FakeMicrosoft {
  readonly requests: FakeAppRequest[] = [];
  private readonly messages = new Map<string, FakeOutlookMessage>();

  constructor(readonly userEmail: string) {}

  /** Seeds a message in the account's Outlook mailbox. */
  addMessage(message: FakeOutlookMessage): FakeOutlookMessage {
    this.messages.set(message.id, message);
    return message;
  }

  /** Deletes a message, as its owner would in Outlook. */
  deleteMessage(id: string): void {
    this.messages.delete(id);
  }

  respond(method: ProxyMethod, path: string, params: URLSearchParams, body: unknown): Response {
    this.requests.push({ method, path, query: Object.fromEntries(params), body });
    if (method === "GET" && path === "/v1.0/me") {
      return HttpResponse.json({
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
        id: "00000000-0000-0000-0000-000000000001",
        displayName: "Microsoft user",
        mail: this.userEmail,
        userPrincipalName: this.userEmail,
      });
    }
    const messageId = method === "GET" ? MESSAGE_PATH.exec(path)?.[1] : undefined;
    const message = messageId === undefined ? undefined : this.messages.get(decodeURI(messageId));
    if (message !== undefined) return HttpResponse.json(graphMessage(message));
    // message.reply: 202 with no body, for a message the mailbox has.
    const replyTo = method === "POST" ? REPLY_PATH.exec(path)?.[1] : undefined;
    if (replyTo !== undefined && this.messages.has(decodeURI(replyTo))) {
      return new HttpResponse(null, { status: 202 });
    }
    return graphError(404, "Request_ResourceNotFound", "Resource not found.");
  }
}

// A message as Graph's message resource has it.
function graphMessage(message: FakeOutlookMessage) {
  return {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('me')/messages/$entity",
    id: message.id,
    subject: message.subject,
    isRead: message.isRead ?? false,
    from: { emailAddress: { name: message.from.split("@")[0], address: message.from } },
    body: { contentType: "text", content: message.body },
  };
}

/** Graph's error body: `{ error: { code, message } }` with a string code. */
export function graphError(status: number, code: string, message: string): Response {
  return HttpResponse.json({ error: { code, message } }, { status });
}
