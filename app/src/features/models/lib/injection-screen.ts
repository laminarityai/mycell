// The injection screen: text Mycel fetched from a company's apps is screened for prompt
// injection before any model reads it, as Google's user data policy requires of apps on
// restricted scopes. It runs a classifier that's billed by the token, so it's metered like any
// model call (invariant 7): the credit check first, with the text's estimated cost, and one usage
// entry naming the service rather than a role. The text is held in memory only (invariant 8).
// With no screen configured, nothing is screened: the verdict is `unavailable`, and callers
// must not let a model read the text.
import { env } from "@/env";
import { checkCredits, recordUsage } from "@/features/credits/server";
import type { Ctx } from "@/lib/ctx";
import {
  InjectionScreenError,
  type InjectionScreen,
  type ScreenRequest,
  type ScreenResult,
} from "../types";
import { modelArmorScreen } from "./model-armor";

/** The configured screen, or null when the env names none. */
function configuredScreen(): InjectionScreen | null {
  const template = env.MODEL_ARMOR_TEMPLATE;
  const workloadIdentityProvider = env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  const serviceAccountEmail = env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (
    template === undefined ||
    workloadIdentityProvider === undefined ||
    serviceAccountEmail === undefined
  ) {
    return null;
  }
  return modelArmorScreen({ template, workloadIdentityProvider, serviceAccountEmail });
}

/**
 * Whether a screen is configured, so a caller can skip fetching what it couldn't screen (Ask
 * Mycel's memory tools, which then say memory is unavailable rather than read it).
 */
export function injectionScreenConfigured(): boolean {
  return configuredScreen() !== null;
}

/** What screening a text of `characters` characters costs, in credits; 0 with no screen. */
export function estimateScreenCredits(characters: number): number {
  return (configuredScreen()?.costUsd(characters) ?? 0) * env.CREDITS_PER_USD;
}

/** Screens `text` for prompt injection, metered against the org. */
export async function screenForInjection(ctx: Ctx, request: ScreenRequest): Promise<ScreenResult> {
  const screen = configuredScreen();
  if (screen === null) return { verdict: "unavailable", costUsd: 0 };
  const costUsd = screen.costUsd(request.text.length);
  await checkCredits(ctx, costUsd * env.CREDITS_PER_USD);

  const usage = {
    role: null,
    modelId: screen.service,
    workflowId: request.workflowId,
    runId: request.runId,
    dryRun: request.dryRun,
    purpose: request.purpose,
  };
  let flagged: boolean;
  try {
    flagged = await screen.isInjection(request.text);
  } catch (error) {
    await recordUsage(ctx, { ...usage, costUsd: 0, outcome: "failed" });
    throw error instanceof InjectionScreenError
      ? error
      : new InjectionScreenError("service_error", screen.service);
  }
  await recordUsage(ctx, { ...usage, costUsd, outcome: "succeeded" });
  return { verdict: flagged ? "flagged" : "clear", costUsd };
}
