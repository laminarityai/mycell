// Scripting the e2e fake AI Gateway (e2e/fake-ai-gateway-server.ts) from a test: each `reply`
// answers the next streamed model step the e2e server asks for, in order.
import type { APIRequestContext } from "@playwright/test";
import { env } from "@/env";
import type { FakeStreamedReply } from "@/testing/fake-ai-gateway-stream";

export type E2eAiGateway = {
  reply(reply: FakeStreamedReply, options?: { costUsd?: number }): Promise<void>;
  /** Model requests nothing was scripted for. */
  unscripted(): Promise<string[]>;
};

function controlUrl(path: string): string {
  if (env.AI_GATEWAY_BASE_URL === undefined) throw new Error("AI_GATEWAY_BASE_URL isn't set");
  return new URL(path, env.AI_GATEWAY_BASE_URL).toString();
}

export async function fakeAiGateway(request: APIRequestContext): Promise<E2eAiGateway> {
  await request.post(controlUrl("/__fake/reset"));
  return {
    async reply(reply, options = {}) {
      const response = await request.post(controlUrl("/__fake/replies"), {
        data: { replies: [{ reply, costUsd: options.costUsd }] },
      });
      if (!response.ok())
        throw new Error(`The fake gateway refused the script: ${await response.text()}`);
    },
    async unscripted() {
      const response = await request.get(controlUrl("/__fake/unscripted"));
      return (await response.json()) as string[];
    },
  };
}
