// What executors take and give back.
import type { ActionName } from "@/features/policy/catalog";
import type { ActionSet } from "@/features/policy/types";
import type { ModelRole, Spec, Step } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import type { BranchPath, CallAttribution, Json } from "../types";
import type { HoldSend } from "./custom-action";

/**
 * What a step sees: the run it's in, the version's spec (so a draft can re-read a range an
 * earlier step read), the outputs of the steps before it, what its model calls are recorded
 * against, the company's action set it looks actions up in, the action executors it runs (the
 * live ones, or a dry run's stubs), what it does with a custom write, and where it records a
 * review.
 */
export type StepContext = {
  ctx: Ctx;
  run: { id: string; connectionId: string; sourceRef: string };
  attribution: CallAttribution;
  spec: Spec;
  outputs: Readonly<Record<string, Json>>;
  actionSet: ActionSet;
  actions: ActionExecutors;
  /** Holds a custom write rather than sending it: for its review in a run, as a report in Try it. */
  holdSend: HoldSend;
  /**
   * Records that an item the run left in its app's pending form waits for a person's review,
   * once however often the step is retried. A dry run records nothing.
   */
  awaitReview: (item: AwaitedItem) => Promise<void>;
};

/**
 * An item waiting for a review, by its ID and its thread's: a Gmail draft, or a message an
 * escalate step handed to a person, with the step's reason for handing it over.
 */
export type AwaitedItem =
  | { kind: "approval"; itemRef: string; threadRef: string }
  | { kind: "escalation"; itemRef: string; threadRef: string; reason: string }
  /** A held send waits on the connection it would be sent through, not the run's. */
  | { kind: "held_send"; itemRef: string; threadRef: string; connectionId: string };

/** What a step did. */
export type StepExecution = {
  /** Go on to the next step, or end the run `skipped` or `escalated`. */
  next: "continue" | "skipped" | "escalated";
  /**
   * Handed on to later steps through the step state, which Inngest stores encrypted: it may
   * carry content, such as a message's body (ADR-0021).
   */
  output: Json;
  /**
   * What run_steps keeps: no content. An extract's field names but not their values, a tool
   * result's fields by kind and size.
   */
  record: Json;
  model?: { role: ModelRole; modelId: string; costUsd: number };
  /**
   * A branch's paths and why each check passed or failed, which may quote values from the
   * email: for Try it's page only. A run neither records nor hands it on.
   */
  paths?: BranchPath[];
};

/**
 * A draft step's generator of the reply's text, held in memory only (invariant 8). The action
 * that writes the draft calls it only when the step hasn't made its draft yet.
 */
export type Compose = () => Promise<string>;

/**
 * One catalog action: a Nango proxy call with the action's validated input. `marker` names the
 * run and step (`<runId>/<stepId>`), for a write to find what an earlier try already did.
 * `compose` is given by a draft step, for the action that writes its draft.
 */
export type ActionRun = (
  ctx: Ctx,
  connectionId: string,
  input: never,
  marker: string,
  compose?: Compose,
) => Promise<Json>;

export type StepRun<S extends Step> = (step: S, context: StepContext) => Promise<StepExecution>;

/** A registry entry: built, or pending with the ticket that builds it. */
export type Executor<Run> = { status: "ready"; run: Run } | { status: "pending"; ticket: string };

/** One executor per catalog action. */
export type ActionExecutors = Record<ActionName, Executor<ActionRun>>;
