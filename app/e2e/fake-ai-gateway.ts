// Scripting the e2e fake AI Gateway (e2e/fake-ai-gateway-server.ts) from a test: each `reply`
// or `fail` answers the next streamed model step the e2e server asks for, in order.
import type { APIRequestContext } from "@playwright/test";
import { env } from "@/env";
import type { FakeStreamedReply } from "@/testing/fake-ai-gateway-stream";

export type E2eAiGateway = {
  reply(reply: FakeStreamedReply, options?: { costUsd?: number }): Promise<void>;
  /**
   * The next streamed model step fails, as the gateway reports errors. `billedUsd` is what the
   * gateway's Generation Lookup then says the failed generation was billed.
   */
  fail(options?: { status?: number; generationId?: string; billedUsd?: number }): Promise<void>;
  /** Model requests nothing was scripted for. */
  unscripted(): Promise<string[]>;
  /** The generation IDs looked up so far, oldest first. */
  lookups(): Promise<string[]>;
};

function controlUrl(path: string): string {
  if (env.AI_GATEWAY_BASE_URL === undefined) throw new Error("AI_GATEWAY_BASE_URL isn't set");
  return new URL(path, env.AI_GATEWAY_BASE_URL).toString();
}

export async function fakeAiGateway(request: APIRequestContext): Promise<E2eAiGateway> {
  await request.post(controlUrl("/__fake/reset"));
  const script = async (step: unknown) => {
    const response = await request.post(controlUrl("/__fake/replies"), {
      data: { replies: [step] },
    });
    if (!response.ok())
      throw new Error(`The fake gateway refused the script: ${await response.text()}`);
  };
  return {
    reply: (reply, options = {}) => script({ reply, costUsd: options.costUsd }),
    fail: (options = {}) => script({ failure: options }),
    async unscripted() {
      const response = await request.get(controlUrl("/__fake/unscripted"));
      return (await response.json()) as string[];
    },
    async lookups() {
      const response = await request.get(controlUrl("/__fake/lookups"));
      return (await response.json()) as string[];
    },
  };
}
