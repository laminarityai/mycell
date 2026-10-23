// The models feature's public types: what a model call takes and returns, the error it throws,
// and the parts a metered chat turn stores.
import type { LanguageModel, UIMessage } from "ai";
import { z } from "zod";
import type { CreditPurpose } from "@/features/credits/types";
import type { ModelRole } from "@/features/spec/types";
import type { PromptText } from "@/lib/prompts";

/**
 * What a model call is for; recorded on its ledger entry. Every call names one: a run's
 * workflow and run, Try it's `dryRun`, or a `purpose` (memory's learning, a person's summary, or the builder chat).
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

/**
 * How looking up a failed call's billed cost ended (`correctFailedCallCost`): `corrected` when
 * the gateway knew it and the ledger now records it; `not_billed_yet` when the gateway can't say
 * yet, so the job looks again later; `given_up` a day after the call; `nothing_to_correct` when
 * the entry is already corrected, or is no failed call recorded at 0 under a generation ID.
 */
export type FailedCallCostOutcome =
  "corrected" | "not_billed_yet" | "given_up" | "nothing_to_correct";

/**
 * The AI Gateway refused a generation lookup for a reason looking again won't fix (a bad key, a
 * malformed request). Built from the status only.
 */
export class GenerationLookupError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The AI Gateway refused the generation lookup (${String(status)}).`);
    this.name = "GenerationLookupError";
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

/** Why a chat turn shows a notice instead of (or after) a reply. */
export const noticeKindSchema = z.enum(["out_of_credits", "failed"]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export type Notice = { kind: NoticeKind; text: string };

/**
 * The parts every chat's stored messages share (`streamChatTurn`): text, one tool call with its
 * result, or a notice. A tool's result is stored as the tool chooses (its `stored`), never as
 * source content (invariant 8). A chat adds part kinds of its own, each with its own `type`, in
 * a discriminated union over these and them.
 */
export const chatPartSchemas = [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    /** What the tool returned, or the error the model was told about. */
    output: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({ type: z.literal("notice"), kind: noticeKindSchema, text: z.string() }),
] as const;
export type ChatPart = z.infer<(typeof chatPartSchemas)[number]>;

/** A stored chat message as its history is read back: the shared parts and the chat's own. */
export type ChatMessage<P> = { id: string; role: "user" | "assistant"; parts: P[] };

/** A chat page's messages as the shared turn streams them: the AI SDK's, with notices. */
export type ChatUIMessage = UIMessage<never, { notice: Notice }>;
export type ChatUIPart = ChatUIMessage["parts"][number];
