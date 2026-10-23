// The fake AI Gateway the e2e server talks to (AI_GATEWAY_BASE_URL), as its own HTTP server,
// since msw can't reach into `next start`. Playwright starts it (playwright.config.ts) and each
// test scripts it through e2e/fixtures.ts: replies and failures queue up and answer streamed
// model steps in order, as the Vitest fake does, and its Generation Lookup answers what a failed
// generation was billed. Run: node --import tsx e2e/fake-ai-gateway-server.ts <port>
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { FakeGenerations } from "@/testing/fake-ai-gateway-generations";
import { streamedReplyEvents } from "@/testing/fake-ai-gateway-stream";

const scriptSchema = z.object({
  replies: z.array(
    z.union([
      z.object({
        reply: z.object({
          text: z.string().optional(),
          toolCalls: z.array(z.object({ name: z.string(), input: z.unknown() })).optional(),
        }),
        costUsd: z.number().optional(),
      }),
      z.object({
        failure: z.object({
          status: z.number().int().optional(),
          generationId: z.string().optional(),
          billedUsd: z.number().optional(),
        }),
      }),
    ]),
  ),
});

type Script = z.infer<typeof scriptSchema>["replies"][number];

let queue: Script[] = [];
let unscripted: string[] = [];
const generations = new FakeGenerations();

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function answer(response: ServerResponse, script: Script): void {
  if ("reply" in script) {
    response
      .writeHead(200, { "content-type": "text/event-stream" })
      .end(streamedReplyEvents(script.reply, script.costUsd));
    return;
  }
  const { status = 500, generationId, billedUsd } = script.failure;
  if (generationId !== undefined && billedUsd !== undefined) {
    generations.bill(generationId, billedUsd);
  }
  json(response, status, {
    error: { message: "Upstream provider failed", type: "internal_server_error" },
    ...(generationId === undefined ? {} : { generationId }),
  });
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "", "http://localhost");
    const path = url.pathname;
    if (path === "/health") {
      response.writeHead(200).end("ok");
    } else if (path === "/__fake/reset") {
      queue = [];
      unscripted = [];
      generations.reset();
      response.writeHead(204).end();
    } else if (path === "/__fake/replies") {
      queue.push(...scriptSchema.parse(await bodyOf(request)).replies);
      response.writeHead(204).end();
    } else if (path === "/__fake/unscripted") {
      json(response, 200, unscripted);
    } else if (path === "/__fake/lookups") {
      json(response, 200, generations.lookups());
    } else if (path === "/v1/generation" && request.method === "GET") {
      const { status, body } = generations.answer(url.searchParams.get("id"));
      json(response, status, body);
    } else if (path.endsWith("/language-model")) {
      await bodyOf(request);
      const streaming = request.headers["ai-language-model-streaming"] === "true";
      const script = streaming ? queue.shift() : undefined;
      if (script === undefined) {
        unscripted.push(`${streaming ? "streamed " : ""}language request`);
        json(response, 500, {
          error: { message: "Nothing scripted", type: "internal_server_error" },
        });
        return;
      }
      answer(response, script);
    } else {
      unscripted.push(`${request.method ?? "?"} ${path}`);
      response.writeHead(404).end();
    }
  })().catch((error: unknown) => {
    response.writeHead(400).end(String(error));
  });
});

server.listen(Number(process.argv[2]));
