// The fake AI Gateway the e2e server talks to (AI_GATEWAY_BASE_URL), as its own HTTP server,
// since msw can't reach into `next start`. Playwright starts it (playwright.config.ts) and each
// test scripts it through e2e/fixtures.ts: replies queue up and answer streamed model steps in
// order, as the Vitest fake does. Run: node --import tsx e2e/fake-ai-gateway-server.ts <port>
import { createServer, type IncomingMessage } from "node:http";
import { z } from "zod";
import { streamedReplyEvents } from "@/testing/fake-ai-gateway-stream";

const scriptSchema = z.object({
  replies: z.array(
    z.object({
      reply: z.object({
        text: z.string().optional(),
        toolCalls: z.array(z.object({ name: z.string(), input: z.unknown() })).optional(),
      }),
      costUsd: z.number().optional(),
    }),
  ),
});

type Script = z.infer<typeof scriptSchema>["replies"][number];

let queue: Script[] = [];
let unscripted: string[] = [];

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

const server = createServer((request, response) => {
  void (async () => {
    const path = request.url ?? "";
    if (path === "/health") {
      response.writeHead(200).end("ok");
    } else if (path === "/__fake/reset") {
      queue = [];
      unscripted = [];
      response.writeHead(204).end();
    } else if (path === "/__fake/replies") {
      queue.push(...scriptSchema.parse(await bodyOf(request)).replies);
      response.writeHead(204).end();
    } else if (path === "/__fake/unscripted") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(unscripted));
    } else if (path.endsWith("/language-model")) {
      await bodyOf(request);
      const streaming = request.headers["ai-language-model-streaming"] === "true";
      const script = streaming ? queue.shift() : undefined;
      if (script === undefined) {
        unscripted.push(`${streaming ? "streamed " : ""}language request`);
        response.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: { message: "Nothing scripted", type: "internal_server_error" },
          }),
        );
        return;
      }
      response
        .writeHead(200, { "content-type": "text/event-stream" })
        .end(streamedReplyEvents(script.reply, script.costUsd));
    } else {
      unscripted.push(`${request.method ?? "?"} ${path}`);
      response.writeHead(404).end();
    }
  })().catch((error: unknown) => {
    response.writeHead(400).end(String(error));
  });
});

server.listen(Number(process.argv[2]));
