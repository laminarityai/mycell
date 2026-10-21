// Seeding the e2e fake Nango (e2e/fake-nango-server.ts) from a test: a Google account with a
// mailbox, its messages and drafts, and what the mailbox then holds.
import type { APIRequestContext } from "@playwright/test";
import { env } from "@/env";
import type { FakeDraft } from "@/testing/fake-gmail-writes";

export type E2eNango = {
  /** A Google connection at Nango for `email`; returns its Nango connection ID. */
  connect(email: string): Promise<string>;
  /** A message just received in the connection's mailbox. */
  receive(
    connectionId: string,
    message: { from: string; subject: string; text: string },
  ): Promise<{ id: string; threadId: string }>;
  /** A draft reply in the message's thread. */
  draft(
    connectionId: string,
    draft: { threadId: string; to: string; subject: string; text: string },
  ): Promise<{ id: string }>;
  /** The mailbox's drafts, and the drafts it has sent. */
  mailbox(connectionId: string): Promise<{ drafts: FakeDraft[]; sent: FakeDraft[] }>;
  /** Requests the fake had no answer for. */
  unhandled(): Promise<string[]>;
};

function controlUrl(path: string): string {
  return new URL(path, env.NANGO_API_URL).toString();
}

export async function fakeNango(request: APIRequestContext): Promise<E2eNango> {
  await request.post(controlUrl("/__fake/reset"));
  const post = async <T>(path: string, data: unknown): Promise<T> => {
    const response = await request.post(controlUrl(path), { data });
    if (!response.ok()) throw new Error(`The fake Nango refused ${path}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  return {
    async connect(email) {
      return (await post<{ connectionId: string }>("/__fake/connection", { email })).connectionId;
    },
    receive: (connectionId, message) => post("/__fake/message", { connectionId, ...message }),
    draft: (connectionId, draft) => post("/__fake/draft", { connectionId, ...draft }),
    async mailbox(connectionId) {
      const url = controlUrl(`/__fake/mailbox?connectionId=${encodeURIComponent(connectionId)}`);
      return (await (await request.get(url)).json()) as { drafts: FakeDraft[]; sent: FakeDraft[] };
    },
    async unhandled() {
      return (await (await request.get(controlUrl("/__fake/unhandled"))).json()) as string[];
    },
  };
}
