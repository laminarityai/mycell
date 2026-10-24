// The AI Gateway's Generation Lookup API (`GET /v1/generation?id=…`), shared by the fake Vitest
// installs (fake-ai-gateway.ts) and the one the e2e server talks to
// (e2e/fake-ai-gateway-server.ts). It knows a generation once a test says what it was billed,
// usually by scripting a failure with `billedUsd`; until then it answers 404, as the gateway does
// before its usage event is ingested. Pure: no msw, no env.

/** A lookup's answer: its HTTP status and JSON body. */
export type FakeLookupAnswer = { status: number; body: Record<string, unknown> };

export class FakeGenerations {
  private billed = new Map<string, number>();
  private looked: string[] = [];
  private failingWith: number | undefined;

  reset(): void {
    this.billed = new Map();
    this.looked = [];
    this.failingWith = undefined;
  }

  /** From now on, the lookup knows the generation and what it was billed, in US dollars. */
  bill(generationId: string, costUsd: number): void {
    this.billed.set(generationId, costUsd);
  }

  /** Makes every lookup answer with this error status, until the next reset. */
  failLookups(status: number): void {
    this.failingWith = status;
  }

  /** The generation IDs looked up so far, oldest first. */
  lookups(): string[] {
    return this.looked;
  }

  answer(generationId: string | null): FakeLookupAnswer {
    if (generationId === null || generationId === "") {
      return error(400, "Missing generation id", "invalid_request_error");
    }
    this.looked.push(generationId);
    if (this.failingWith !== undefined) {
      return error(this.failingWith, "Internal server error", "internal_server_error");
    }
    const costUsd = this.billed.get(generationId);
    if (costUsd === undefined) return error(404, "Usage event not found", "not_found_error");
    return { status: 200, body: { data: generationInfo(generationId, costUsd) } };
  }
}

function error(status: number, message: string, type: string): FakeLookupAnswer {
  return { status, body: { error: { message, type } } };
}

// The documented response's fields (https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api).
function generationInfo(id: string, costUsd: number) {
  return {
    id,
    total_cost: costUsd,
    market_cost: costUsd,
    surcharge_cost: 0,
    gateway_cost: costUsd,
    upstream_inference_cost: 0,
    usage: costUsd,
    created_at: new Date().toISOString(),
    model: "fake/model",
    is_byok: false,
    provider_name: "fake",
    streamed: false,
    finish_reason: "error",
    latency: 0,
    generation_time: 0,
    tokens_prompt: 10,
    tokens_completion: 0,
    native_tokens_prompt: 10,
    native_tokens_completion: 0,
    native_tokens_reasoning: 0,
    native_tokens_cached: 0,
    native_tokens_cache_creation: 0,
    billable_web_search_calls: 0,
  };
}
