import { z } from "zod";
import type { Spec, SpecIssue } from "@/features/spec/types";

/** Risk levels, least to most dangerous (docs/architecture.md, "Risk policy"). */
export const riskLevelSchema = z.enum([
  "read",
  "internal_reversible",
  "external_send",
  "financial",
  "destructive",
]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** One operation a workflow may call, with the risk level our team fixed for it. */
export type CatalogAction = {
  readonly name: string;
  /** The app it acts in, as admins name it. */
  readonly app: "Gmail" | "Sheets";
  /** What it does, in a sentence the builder chat reads. */
  readonly description: string;
  readonly risk: RiskLevel;
  /**
   * Where an `external_send` action waits for a person's review, inside its app (ADR-0013),
   * such as "a Gmail draft". Every external send has one; other actions have none.
   */
  readonly pendingForm?: string;
  readonly integration: "google";
  /** The API host the Nango proxy reaches, set with its base-URL override (ADR-0014). */
  readonly host: string;
  /** Granted OAuth scopes, any one of which allows the action. */
  readonly scopes: readonly string[];
  /** The action's input once references are resolved. */
  readonly input: z.ZodType;
  /** What the action hands on: derived data and IDs only, never content (ADR-0012). */
  readonly output: z.ZodType;
};

/** An approval step the policy engine added because the spec was missing it. */
export type InsertedApproval = {
  /** The new approval step's ID. */
  stepId: string;
  /** The step whose external-send action needed it; the approval comes right after it. */
  after: string;
  action: string;
};

export type PolicyResult =
  | { ok: true; spec: Spec; maxRisk: RiskLevel; inserted: InsertedApproval[] }
  | { ok: false; issues: SpecIssue[] };
