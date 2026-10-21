// The one way runtime calls a model. Each call resolves its role to the org's model (invariant
// 6), passes the credit check before anything is sent, and records exactly one usage entry
// with the gateway's cost once the gateway answers, whether the call succeeded or not
// (invariant 7). Errors leave as ModelCallError, with no content in them (invariant 8).
import {
  Experimental_DecisionRefusalError,
  generateText,
  NoObjectGeneratedError,
  Output,
} from "ai";
import { env } from "@/env";
import { checkCredits, recordUsage } from "@/features/credits/server";
import type { ModelRole } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import {
  ModelCallError,
  type CallAttribution,
  type ModelResult,
  type ObjectRequest,
  type TextRequest,
} from "../types";
import { meteredGateway, type MeteredGateway } from "./gateway";
import { resolveModel } from "./model-roles";

/** The credits a call on each role must find in the balance before it's made. */
export const CREDIT_ESTIMATES: Record<ModelRole, number> = {
  classify: env.CREDIT_ESTIMATE_CLASSIFY,
  fast: env.CREDIT_ESTIMATE_FAST,
  smart: env.CREDIT_ESTIMATE_SMART,
  judge: env.CREDIT_ESTIMATE_JUDGE,
};

/** Calls the role's model for text, or for structured output when the request has a schema. */
export function callModel(
  ctx: Ctx,
  role: ModelRole,
  request: TextRequest,
): Promise<ModelResult<string>>;
export function callModel<T>(
  ctx: Ctx,
  role: ModelRole,
  request: ObjectRequest<T>,
): Promise<ModelResult<T>>;
export async function callModel<T>(
  ctx: Ctx,
  role: ModelRole,
  request: TextRequest | ObjectRequest<T>,
): Promise<ModelResult<string | T>> {
  return meteredCall(ctx, role, request, async (gateway, modelId) => {
    const options = {
      model: gateway.provider(modelId),
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: request.maxOutputTokens,
      // Retries belong to the run's step, so each attempt is one check and one ledger entry.
      maxRetries: 0,
    };
    if (!("schema" in request)) return (await generateText(options)).text;
    const result = await generateText({
      ...options,
      output: Output.object({ schema: request.schema }),
    });
    return result.output;
  });
}

/**
 * Runs one gateway call for the role, between the credit check and the usage entry. `call` may
 * throw a ModelCallError of its own when an answer arrived but can't be used.
 */
export async function meteredCall<R>(
  ctx: Ctx,
  role: ModelRole,
  attribution: CallAttribution,
  call: (gateway: MeteredGateway, modelId: string) => Promise<R>,
): Promise<ModelResult<R>> {
  const modelId = await resolveModel(ctx, role);
  await checkCredits(ctx, CREDIT_ESTIMATES[role]);

  const gateway = meteredGateway();
  const usage = {
    role,
    modelId,
    workflowId: attribution.workflowId,
    runId: attribution.runId,
    dryRun: attribution.dryRun,
  };
  let output: R;
  try {
    output = await call(gateway, modelId);
  } catch (error) {
    const { costUsd, generationId } = gateway.metering();
    await recordUsage(ctx, { ...usage, costUsd, generationId, outcome: "failed" });
    throw toModelCallError(error, role, modelId);
  }
  const { costUsd, generationId } = gateway.metering();
  await recordUsage(ctx, { ...usage, costUsd, generationId, outcome: "succeeded" });
  return { output, modelId, costUsd };
}

// Never keeps the original as `cause`: AI SDK errors quote the model's output.
function toModelCallError(error: unknown, role: ModelRole, modelId: string): ModelCallError {
  if (error instanceof ModelCallError) return error;
  if (NoObjectGeneratedError.isInstance(error))
    return new ModelCallError("off_schema", role, modelId);
  if (Experimental_DecisionRefusalError.isInstance(error)) {
    return new ModelCallError("refused", role, modelId);
  }
  return new ModelCallError("gateway_error", role, modelId, statusOf(error));
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}
