// A streamed model call's metering, for callers that run `streamText` themselves (the builder
// chat's turns). Opening one resolves the role to the org's model (invariant 6) and passes the
// credit check before anything is sent; the caller meters each model step as it ends and
// finishes once, which records exactly one usage entry with the steps' summed gateway cost,
// however the stream ended (invariant 7).
import { createGateway } from "ai";
import { checkCredits, recordUsage } from "@/features/credits/server";
import type { ModelRole } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import { env } from "@/env";
import type { CallAttribution, MeteredStream } from "../types";
import { CREDIT_ESTIMATES } from "./call-model";
import { meteringOf } from "./gateway";
import { resolveModel } from "./model-roles";

/** Throws OutOfCreditsError, before any request, when the balance can't cover the role. */
export async function openMeteredStream(
  ctx: Ctx,
  role: ModelRole,
  attribution: CallAttribution = {},
): Promise<MeteredStream> {
  const modelId = await resolveModel(ctx, role);
  await checkCredits(ctx, CREDIT_ESTIMATES[role]);

  // A plain gateway provider: the metering fetch of `meteredGateway` reads JSON bodies, which
  // would hold back a stream. A streamed step reports its cost on its finish part instead.
  const provider = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  let costUsd = 0;
  let generationId: string | undefined;
  let finished = false;
  return {
    modelId,
    model: provider(modelId),
    meterStep(providerMetadata) {
      const metering = meteringOf({ providerMetadata });
      costUsd += metering.costUsd;
      generationId = metering.generationId ?? generationId;
    },
    async finish(outcome) {
      if (finished) return;
      finished = true;
      await recordUsage(ctx, { role, modelId, costUsd, generationId, outcome, ...attribution });
    },
  };
}
