// A streamed model call's metering, for callers that run `streamText` themselves (the builder
// chat's turns). Opening one resolves the role to the org's model (invariant 6) and passes the
// credit check before anything is sent; the caller meters each model step as it ends, and the
// error of a step that fails, and finishes once, which records the steps' summed gateway cost,
// however the stream ended (invariant 7). A failed step reports no cost, so its cost is looked
// up later under the generation ID its error carries (`failed-call-costs.ts`): when earlier
// steps reported a cost, the failed step gets an entry of its own at 0, which is looked up.
import { checkCredits } from "@/features/credits/server";
import type { ModelRole } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import type { CallAttribution, MeteredStream } from "../types";
import { CREDIT_ESTIMATES } from "./call-model";
import { recordCallUsage } from "./failed-call-costs";
import { gatewayProvider, generationIdOf, meteringOf } from "./gateway";
import { resolveModel } from "./model-roles";

/** Throws OutOfCreditsError, before any request, when the balance can't cover the role. */
export async function openMeteredStream(
  ctx: Ctx,
  role: ModelRole,
  attribution: CallAttribution = {},
): Promise<MeteredStream> {
  const [modelId] = await Promise.all([
    resolveModel(ctx, role),
    checkCredits(ctx, CREDIT_ESTIMATES[role]),
  ]);

  // A plain gateway provider: the metering fetch of `meteredGateway` reads JSON bodies, which
  // would hold back a stream. A streamed step reports its cost on its finish part instead.
  const provider = gatewayProvider();
  let costUsd = 0;
  let stepGenerationId: string | undefined;
  let failedGenerationId: string | undefined;
  let finished = false;
  return {
    modelId,
    model: provider(modelId),
    meterStep(providerMetadata) {
      const metering = meteringOf({ providerMetadata });
      costUsd += metering.costUsd;
      stepGenerationId = metering.generationId ?? stepGenerationId;
    },
    meterError(error) {
      failedGenerationId = generationIdOf(error) ?? failedGenerationId;
    },
    async finish(outcome) {
      if (finished) return;
      finished = true;
      const call = { role, modelId, outcome, ...attribution };
      if (failedGenerationId === undefined || costUsd === 0) {
        const generationId = failedGenerationId ?? stepGenerationId;
        await recordCallUsage(ctx, { ...call, costUsd, generationId });
        return;
      }
      // An entry above 0 is never looked up, so the failed step, which reported no cost, gets
      // its own entry at 0 under its generation ID, apart from the steps that reported theirs.
      await recordCallUsage(ctx, { ...call, costUsd, generationId: stepGenerationId });
      await recordCallUsage(ctx, {
        ...call,
        costUsd: 0,
        generationId: failedGenerationId,
        outcome: "failed",
      });
    },
  };
}
