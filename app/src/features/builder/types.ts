// The builder feature's public types: builder conversations, their stored messages, and the
// UI messages the chat page streams.
import type { UIMessage } from "ai";
import { z } from "zod";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import type { RiskLevel } from "@/features/policy/types";
import type { StepDescription } from "@/features/spec/describe";
import type { Change } from "@/features/spec/diff";
import type { Spec } from "@/features/spec/types";

/** Why the agent's turn shows a notice instead of (or after) a reply. */
export const noticeKindSchema = z.enum(["out_of_credits", "failed"]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export type Notice = { kind: NoticeKind; text: string };

/**
 * One part of a stored message: text, one tool call with its result, or a notice. A tool's
 * result is stored as the tool chooses (`read_examples` keeps only source refs), never as
 * source content (invariant 8).
 */
export const storedPartSchema = z.discriminatedUnion("type", [
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
  /** An admin tried the working spec: what each step did, without the message's content. */
  z.object({
    type: z.literal("try_it"),
    lines: z.array(z.string()),
    costUsd: z.number(),
  }),
]);
export type StoredPart = z.infer<typeof storedPartSchema>;

/** A message of a builder conversation: an admin's or the agent's. */
export type BuilderMessage = {
  id: string;
  role: "user" | "assistant";
  /** The admin who wrote it; null for the agent's. */
  authorId: string | null;
  parts: StoredPart[];
  createdAt: Date;
};

/** A row of the conversation list. */
export type ConversationSummary = {
  id: string;
  title: string | null;
  startedBy: string;
  workflowId: string | null;
  updatedAt: Date;
};

export type BuilderConversation = ConversationSummary & {
  createdAt: Date;
  /** Oldest first. */
  messages: BuilderMessage[];
};

/** A try-it summary as the conversation keeps it: content-free lines, and what it cost. */
export type TryItSummary = { lines: string[]; costUsd: number };

/** The chat page's messages: the AI SDK's UI messages, with notices and try-it summaries. */
export type BuilderUIMessage = UIMessage<never, { notice: Notice; tryIt: TryItSummary }>;

/**
 * `stale`: the workflow's working spec changed after the proposal was made against it, so
 * accepting it was refused. Nothing is ever merged automatically.
 */
export type ProposalStatus = "proposed" | "accepted" | "rejected" | "stale";

/** One step of a proposal's before/after, in plain words. */
export type ProposalStep = StepDescription<RiskLevel> & {
  change: Change;
  /** For a changed step, what it did before. */
  before: string | null;
};

/** A path a proposal's changes are grouped under, in plain words. */
export type ProposalPath = {
  id: string;
  /** The branch it leaves. */
  branchId: string;
  /** The path's name; "Otherwise" for a branch's otherwise path. */
  name: string;
  /** The names of the paths it sits on, outermost first; empty under a top-level branch. */
  within: string[];
  otherwise: boolean;
  change: Change;
  /** When it runs: "Runs when …". */
  text: string;
  /** For a changed path, its name and words before. */
  before: { name: string; text: string } | null;
};

/**
 * The changed steps of one list: the steps before any branch (no path), or one path's. A
 * group is listed when its path or one of its steps changed.
 */
export type ProposalGroup = { path: ProposalPath | null; steps: ProposalStep[] };

/** A proposal as the conversation shows it. */
export type Proposal = {
  id: string;
  conversationId: string;
  /** The workflow it changes; null for a new workflow not yet accepted. */
  workflowId: string | null;
  name: string;
  summary: string;
  status: ProposalStatus;
  maxRisk: RiskLevel;
  /**
   * What it changes, grouped by path in the order a run reaches them (policy-inserted approvals
   * included), each removed step or path where it stood. For a new workflow, everything.
   */
  groups: ProposalGroup[];
  /** Top-level settings it changes, such as `credentials`. */
  settings: string[];
  /** The working spec it proposes, as written (the graph applies the policy engine itself). */
  spec: Spec;
  /** The working spec it was made against; null for a new workflow. */
  baseSpec: Spec | null;
  /** The new custom actions it brings, in plain words: stored only if it's accepted. */
  customActions: ProposedCustomAction[];
  /** The same, as the records the graph builds the action set it draws the proposal with from. */
  customActionRecords: CustomActionRecord[];
  createdAt: Date;
  decidedAt: Date | null;
};

/**
 * A new custom action as a proposal shows it (ADR-0018): its app, what it does, the call it makes
 * and the risk level the fixed rule set.
 */
export type ProposedCustomAction = {
  name: string;
  /** The registered app, as admins name it. */
  app: string;
  description: string;
  /** The method and path, such as "GET /v1.0/me/messages/{messageId}". */
  call: string;
  risk: RiskLevel;
};

/** What `propose_spec` tells the model, and what the conversation keeps of it. */
export type ProposeSpecResult =
  | { ok: true; proposalId: string; message: string }
  | {
      ok: false;
      /** Three proposals in the turn failed: the admin sees these issues. */
      gaveUp: boolean;
      issues: { path: (string | number)[]; message: string }[];
      message: string;
    };
