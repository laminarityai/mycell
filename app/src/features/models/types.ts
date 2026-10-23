// The models feature's public types: what a model call takes and returns, and the error it
// throws.
import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { CreditPurpose } from "@/features/credits/types";
import type { ModelRole } from "@/features/spec/types";
import type { PromptText } from "@/lib/prompts";

/**
 * What a model call is for; recorded on its ledger entry. Every call names one: a run's
 * workflow and run, Try it's `dryRun`, or a `purpose` (memory, or the builder chat).
 */
export type CallAttribution = {
  workflowId?: string;
  runId?: string;
  dryRun?: boolean;
  purpose?: CreditPurpose;
};

/** A streamed call's model and its metering (`openMeteredStream`). */
export type MeteredStream = {
  modelId: string;
  model: LanguageModel;
  /** Adds one finished model step's cost, read from its `providerMetadata.gateway`. */
  meterStep(providerMetadata: unknown): void;
  /**
   * Records the call's usage: the cost of every step metered so far. Only the first call
   * records; later ones do nothing, so every way a stream can end may call it.
   */
  finish(outcome: "succeeded" | "failed"): Promise<void>;
};

/**
 * A text call. Its `system` and `prompt` are rendered from a prompt file (`@/lib/prompts`), with
 * anything not written for the model, such as a message, filled in as a variable.
 */
export type TextRequest = CallAttribution & {
  system?: PromptText;
  prompt: PromptText;
  maxOutputTokens?: number;
};

/** A structured-output call: the answer must parse with `schema`. */
export type ObjectRequest<T> = TextRequest & { schema: z.ZodType<T> };

/** An embedding call: the texts to turn into vectors, one vector each. */
export type EmbedRequest = CallAttribution & { values: string[] };

/** A model call's answer, the model the role resolved to, and what the gateway charged. */
export type ModelResult<T> = { output: T; modelId: string; costUsd: number };

/** A classify answer, normalized: Jev's own format never leaves the adapter. */
export type Classification = {
  label: string;
  p: number;
  modelId: string;
  costUsd: number;
  /**
   * True when Jev failed (or the classify model isn't a decision model) and the `fast` role
   * answered with a structured output instead; `p` is then the model's stated confidence.
   */
  fallback: boolean;
};

/** A classify request: which label, of 2 to 10, fits `state` best. */
export type ClassifyRequest = CallAttribution & {
  /** Rendered from a prompt file, like a text call's prompt; a spec's question as a variable. */
  question: PromptText;
  labels: string[];
  /** What to classify, such as the message's sender, subject and text, held in memory only. */
  state: string;
};

export const modelCallErrorCodes = [
  // The gateway answered with an error, or couldn't be reached.
  "gateway_error",
  // The answer didn't match the request's schema.
  "off_schema",
  // Jev refused to answer the question.
  "refused",
  // Jev answered without probabilities, so there is no confidence to gate on.
  "no_probabilities",
  // Jev chose something that isn't one of the labels.
  "unknown_label",
] as const;
export type ModelCallErrorCode = (typeof modelCallErrorCodes)[number];

/**
 * A model call failed. Its message is built from codes only and it carries no `cause`, because
 * Inngest stores a step's thrown error, and the AI SDK's errors quote the model's output
 * (invariant 8).
 */
export class ModelCallError extends Error {
  readonly code: ModelCallErrorCode;
  readonly role: ModelRole;
  readonly modelId: string;
  /** The gateway's HTTP status, when it answered with an error. */
  readonly status: number | undefined;

  constructor(code: ModelCallErrorCode, role: ModelRole, modelId: string, status?: number) {
    super(
      `The ${role} model call to ${modelId} failed: ${code}` +
        (status === undefined ? "." : ` (${String(status)}).`),
    );
    this.name = "ModelCallError";
    this.code = code;
    this.role = role;
    this.modelId = modelId;
    this.status = status;
  }
}

/** An injection screen request: text fetched for a model, held in memory only. */
export type ScreenRequest = CallAttribution & { text: string };

/**
 * What the injection screen found: `flagged` when the text tries to instruct a model, `clear`
 * when it doesn't, and `unavailable` when no screen is configured, so nothing was screened and
 * no model may read the text.
 */
export type ScreenVerdict = "clear" | "flagged" | "unavailable";

export type ScreenResult = { verdict: ScreenVerdict; costUsd: number };

/** A screening service behind the injection screen. Model Armor is the one Mycel uses. */
export type InjectionScreen = {
  /** What the ledger names as the call's model: `provider/service`. */
  service: string;
  /** What screening a text of `characters` characters costs, in US dollars, estimated before. */
  costUsd(characters: number): number;
  /** Whether `text` tries to instruct a model. Throws InjectionScreenError when it can't say. */
  isInjection(text: string): Promise<boolean>;
};

export const injectionScreenErrorCodes = [
  // Mycel couldn't get an access token for the screening service.
  "auth_error",
  // The service answered with an error, or couldn't be reached.
  "service_error",
  // The service answered, but not with a prompt-injection verdict (its filter didn't run).
  "no_verdict",
] as const;
export type InjectionScreenErrorCode = (typeof injectionScreenErrorCodes)[number];

/**
 * The injection screen failed, so the text wasn't screened and no model may read it. Built from
 * codes only and with no `cause`, like ModelCallError (invariant 8).
 */
export class InjectionScreenError extends Error {
  readonly code: InjectionScreenErrorCode;
  readonly service: string;
  readonly status: number | undefined;

  constructor(code: InjectionScreenErrorCode, service: string, status?: number) {
    super(
      `The injection screen ${service} failed: ${code}` +
        (status === undefined ? "." : ` (${String(status)}).`),
    );
    this.name = "InjectionScreenError";
    this.code = code;
    this.service = service;
    this.status = status;
  }
}
