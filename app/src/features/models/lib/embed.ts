// The embed role: texts in, one vector each out. Metered like any model call (invariant 7):
// resolved to the org's model, the credit check first, and one usage entry with the gateway's
// cost. The texts are held in memory only (invariant 8).
import { embedMany } from "ai";
import type { Ctx } from "@/lib/ctx";
import type { EmbedRequest, ModelResult } from "../types";
import { meteredCall } from "./call-model";

/** One vector per text in `values`, in the same order. */
export async function embed(ctx: Ctx, request: EmbedRequest): Promise<ModelResult<number[][]>> {
  return meteredCall(ctx, "embed", request, async (gateway, modelId) => {
    const { embeddings } = await embedMany({
      model: gateway.provider.embeddingModel(modelId),
      values: request.values,
      // The gateway takes 2048 texts a request; more go in further requests, one at a time.
      maxParallelCalls: 1,
      // Retries belong to the caller's step, as for every model call.
      maxRetries: 0,
    });
    return embeddings;
  });
}
