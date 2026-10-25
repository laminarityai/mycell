// The fake AI Gateway: Vercel's AI Gateway behind msw's fetch interception, so model calls run
// the real AI SDK without network or keys. Each test scripts the answers it expects, in order:
// a Jev decision, a structured output, a text, a streamed reply (text and tool calls, for the
// builder chat), embeddings, or a failure, each with the cost the gateway reports. A request with no script
// left (or the wrong key) fails the test after it ends. Its Generation Lookup answers what a
// failed generation was billed, once a test says.
import { http, HttpResponse } from "msw";
import { env } from "@/env";
import { FakeGenerations } from "./fake-ai-gateway-generations";
import {
  costMetadata,
  streamedReplyEvents,
  type FakeStreamedReply,
} from "./fake-ai-gateway-stream";

const BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";

export type FakeGatewayEndpoint = "decision" | "language" | "embedding";

/** A request the fake received: which endpoint, for which model, with what body. */
export type FakeGatewayRequest = {
  endpoint: FakeGatewayEndpoint;
  modelId: string;
  /** Whether the AI SDK asked for a stream (`streamText`) rather than one answer. */
  streaming: boolean;
  body: Record<string, unknown>;
};

export type { FakeStreamedReply };

type ScriptOptions = {
  /** The cost the gateway reports, in US dollars (sent as a string, like the real one). */
  costUsd?: number;
  /** The generation ID the gateway reports beside the cost. */
  generationId?: string;
  /** Answer only a request for this model; by default, the next request to the endpoint. */
  model?: string;
};

type FailureOptions = {
  status?: number;
  /** The generation ID a billed failure carries. */
  generationId?: string;
  /**
   * What the gateway billed the failed generation, in US dollars: its Generation Lookup knows
   * it from when the failure is answered. Unset, the lookup doesn't know the generation (404)
   * until `bill` says so.
   */
  billedUsd?: number;
  model?: string;
};

type Script = {
  endpoint: FakeGatewayEndpoint;
  model?: string;
  /** A streamed script answers only a streaming request, and the others only the others. */
  streaming: boolean;
  respond: () => Response;
};

class FakeAiGateway {
  private scripts: Script[] = [];
  private received: FakeGatewayRequest[] = [];
  private unexpected: string[] = [];
  private readonly generations = new FakeGenerations();

  reset(): void {
    this.scripts = [];
    this.received = [];
    this.unexpected = [];
    this.generations.reset();
  }

  /** Jev's answer to the next decision: a choice and its probabilities, or a refusal. */
  decision(
    answer: { choice: string; probabilities?: Record<string, number> } | "refusal",
    options: ScriptOptions = {},
  ): void {
    this.script("decision", options.model, () => {
      const questionAnswer =
        answer === "refusal" ? { type: "refusal" } : { type: "choice", ...answer };
      return HttpResponse.json({
        // Every request asks one question, under one ID; the fake answers that ID.
        answers: { [this.lastQuestionId()]: questionAnswer },
        usage: { inputTokens: 40, outputTokens: 0 },
        providerMetadata: costMetadata(options.costUsd, options.generationId),
      });
    });
  }

  /** A structured output: `value` as JSON text. Pass a value off the schema to test that. */
  object(value: unknown, options: ScriptOptions = {}): void {
    this.text(JSON.stringify(value), options);
  }

  /** A text answer. */
  text(text: string, options: ScriptOptions = {}): void {
    this.script("language", options.model, () =>
      HttpResponse.json({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        providerMetadata: costMetadata(options.costUsd, options.generationId),
        warnings: [],
      }),
    );
  }

  /** The vectors for the next embedding request, one per text it sent. */
  embeddings(vectors: number[][], options: ScriptOptions = {}): void {
    this.script("embedding", options.model, () =>
      HttpResponse.json({
        embeddings: vectors,
        usage: { tokens: 8 },
        providerMetadata: costMetadata(options.costUsd, options.generationId),
      }),
    );
  }

  /**
   * A streamed answer to one model step of a `streamText` call, as the gateway's server-sent
   * events: the text in a few deltas, then each tool call, then the finish with the cost. A
   * reply with tool calls makes the AI SDK run them and ask again, so script that next step too.
   */
  reply(reply: FakeStreamedReply, options: ScriptOptions = {}): void {
    this.script("language", options.model, () => streamedResponse(reply, options), true);
  }

  /** The next request to the endpoint fails, as the gateway reports errors. */
  fail(
    endpoint: FakeGatewayEndpoint,
    options: FailureOptions & { streaming?: boolean } = {},
  ): void {
    const { status = 500, generationId, billedUsd } = options;
    this.script(
      endpoint,
      options.model,
      () => {
        if (generationId !== undefined && billedUsd !== undefined) {
          this.generations.bill(generationId, billedUsd);
        }
        return HttpResponse.json(
          {
            error: { message: "Upstream provider failed", type: "internal_server_error" },
            ...(generationId === undefined ? {} : { generationId }),
          },
          { status },
        );
      },
      options.streaming ?? false,
    );
  }

  /** From now on, the Generation Lookup knows the generation and what it was billed. */
  bill(generationId: string, costUsd: number): void {
    this.generations.bill(generationId, costUsd);
  }

  /** Makes every generation lookup answer with this error status, until the next reset. */
  failLookups(status: number): void {
    this.generations.failLookups(status);
  }

  /** The generation IDs looked up so far, oldest first. */
  lookups(): string[] {
    return this.generations.lookups();
  }

  /** The requests received so far, oldest first, optionally for one endpoint. */
  requests(endpoint?: FakeGatewayEndpoint): FakeGatewayRequest[] {
    return this.received.filter(
      (request) => endpoint === undefined || request.endpoint === endpoint,
    );
  }

  /** Requests nothing was scripted for. The setup file fails the test if there are any. */
  unscripted(): string[] {
    return this.unexpected;
  }

  readonly handlers = [
    http.post(`${BASE_URL}/decision-model`, ({ request }) => this.handle("decision", request)),
    http.post(`${BASE_URL}/language-model`, ({ request }) => this.handle("language", request)),
    http.post(`${BASE_URL}/embedding-model`, ({ request }) => this.handle("embedding", request)),
    http.get(`${new URL(BASE_URL).origin}/v1/generation`, ({ request }) => {
      if (request.headers.get("authorization") !== `Bearer ${env.AI_GATEWAY_API_KEY}`) {
        return unauthorized();
      }
      const { status, body } = this.generations.answer(new URL(request.url).searchParams.get("id"));
      return HttpResponse.json(body, { status });
    }),
  ];

  private script(
    endpoint: FakeGatewayEndpoint,
    model: string | undefined,
    respond: () => Response,
    streaming = false,
  ) {
    this.scripts.push({ endpoint, model, respond, streaming });
  }

  private lastQuestionId(): string {
    const questions = this.received.at(-1)?.body.questions;
    return Object.keys(questions ?? {}).at(0) ?? "question";
  }

  private async handle(endpoint: FakeGatewayEndpoint, request: Request): Promise<Response> {
    if (request.headers.get("authorization") !== `Bearer ${env.AI_GATEWAY_API_KEY}`) {
      return unauthorized();
    }
    const modelId =
      request.headers.get(endpoint === "language" ? "ai-language-model-id" : "ai-model-id") ?? "";
    const streaming = request.headers.get("ai-language-model-streaming") === "true";
    this.received.push({
      endpoint,
      modelId,
      streaming,
      body: (await request.json()) as Record<string, unknown>,
    });
    const index = this.scripts.findIndex(
      (script) =>
        script.endpoint === endpoint &&
        script.streaming === streaming &&
        (script.model === undefined || script.model === modelId),
    );
    const script = index === -1 ? undefined : this.scripts.splice(index, 1).at(0);
    if (script === undefined) {
      this.unexpected.push(`${streaming ? "streamed " : ""}${endpoint} request for ${modelId}`);
      return HttpResponse.json(
        { error: { message: "Nothing scripted", type: "internal_server_error" } },
        { status: 500 },
      );
    }
    return script.respond();
  }
}

function unauthorized(): Response {
  return HttpResponse.json(
    { error: { message: "Invalid API key", type: "authentication_error" } },
    { status: 401 },
  );
}

function streamedResponse(reply: FakeStreamedReply, options: ScriptOptions): Response {
  return new HttpResponse(streamedReplyEvents(reply, options.costUsd, options.generationId), {
    headers: { "content-type": "text/event-stream" },
  });
}

export const fakeAiGateway = new FakeAiGateway();
