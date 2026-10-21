// The fake Nango the e2e server talks to (NANGO_API_URL), as its own HTTP server, since msw
// can't reach into `next start`: it answers every request with the Vitest fake's own handlers
// (src/testing/fake-nango.ts), proxy and fake Gmail included. Playwright starts it
// (playwright.config.ts) and each test seeds it through e2e/fake-nango.ts.
// Run: node --import tsx e2e/fake-nango-server.ts <port>
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getResponse } from "msw";
import { z } from "zod";
import { fakeNango } from "@/testing/fake-nango";
import { NANGO_API } from "@/testing/fake-nango-http";

let unhandled: string[] = [];

const connectionInput = z.object({ email: z.string() });
const messageInput = z.object({
  connectionId: z.string(),
  from: z.string(),
  subject: z.string(),
  text: z.string(),
});
const draftInput = z.object({
  connectionId: z.string(),
  threadId: z.string(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
});

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
}

// The test's own calls: seed a connection, a message and a draft; read the mailbox back.
async function control(request: IncomingMessage, response: ServerResponse, url: URL) {
  const body = await bodyOf(request);
  const input = (): unknown => JSON.parse(body);
  switch (url.pathname) {
    case "/__fake/reset":
      fakeNango.reset();
      unhandled = [];
      return response.writeHead(204).end();
    case "/__fake/connection": {
      const { email } = connectionInput.parse(input());
      json(response, {
        connectionId: fakeNango.seedConnection("google", { emailAddress: email }),
      });
      return;
    }
    case "/__fake/message": {
      const { connectionId, ...message } = messageInput.parse(input());
      const added = fakeNango.mailbox(connectionId).add({ ...message, at: new Date() });
      json(response, { id: added.id, threadId: added.threadId });
      return;
    }
    case "/__fake/draft": {
      const { connectionId, threadId, to, subject, text } = draftInput.parse(input());
      const draft = fakeNango
        .mailbox(connectionId)
        .addDraft(threadId, { headers: { to, subject }, text });
      json(response, { id: draft?.id });
      return;
    }
    case "/__fake/mailbox": {
      const mailbox = fakeNango.mailbox(url.searchParams.get("connectionId") ?? "");
      json(response, { drafts: mailbox.drafts(), sent: mailbox.writes.sent });
      return;
    }
    case "/__fake/unhandled": {
      json(response, unhandled);
      return;
    }
    default:
      return response.writeHead(404).end();
  }
}

// Everything else is a call to Nango's API, answered as msw answers it in Vitest.
async function nango(request: IncomingMessage, response: ServerResponse, url: URL) {
  const body = await bodyOf(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const answer = await getResponse(
    fakeNango.handlers,
    new Request(`${NANGO_API}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(body === "" ? {} : { body }),
    }),
  );
  if (answer === undefined) {
    unhandled.push(`${request.method ?? "?"} ${url.pathname}`);
    return response.writeHead(404).end();
  }
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const handle =
    url.pathname === "/health"
      ? () => Promise.resolve(response.writeHead(200).end("ok"))
      : url.pathname.startsWith("/__fake/")
        ? () => control(request, response, url)
        : () => nango(request, response, url);
  handle().catch((error: unknown) => {
    unhandled.push(`error: ${String(error)}`);
    response.writeHead(500).end(String(error));
  });
});

server.listen(Number(process.argv[2]));
