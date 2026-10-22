import { z } from "zod";
import type { ConditionField, Spec, SpecIssue } from "@/features/spec/types";

/** Risk levels, least to most dangerous (docs/architecture.md, "Risk policy"). */
export const riskLevelSchema = z.enum([
  "read",
  "internal_reversible",
  "external_send",
  "financial",
  "destructive",
]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** The connection apps a catalog action may act in, as admins name them. */
export type ConnectionApp = "Gmail" | "Sheets";

/** What every catalog action has, whatever it acts on. */
type CatalogActionBase = {
  readonly name: string;
  /** What it does, in a sentence the builder chat reads. */
  readonly description: string;
  readonly risk: RiskLevel;
  /**
   * Where an `external_send` action waits for a person's review, inside its app (ADR-0013),
   * such as "a Gmail draft". Every external send has one; other actions have none.
   */
  readonly pendingForm?: string;
  /** The action's input once references are resolved. */
  readonly input: z.ZodType;
  /** What the action hands on to later steps. */
  readonly output: z.ZodType;
  /**
   * The fields of `output` a branch's condition may test (ADR-0015), each with its type, as
   * `{ from: "<step>.<name>" }`. An explicit list, so no ID becomes something to branch on.
   */
  readonly conditionFields?: readonly ConditionField[];
};

/** An action in one of the connection's Google apps, through the Nango proxy. */
export type GoogleCatalogAction = CatalogActionBase & {
  /** The app it acts in, as admins name it. */
  readonly app: ConnectionApp;
  readonly integration: "google";
  /** The API host the Nango proxy reaches, set with its base-URL override (ADR-0014). */
  readonly host: string;
  /** Granted OAuth scopes, any one of which allows the action. */
  readonly scopes: readonly string[];
};

/**
 * An action on what Mycel itself holds, such as reading memory: it calls no app, so it needs
 * no app or scope of the connection a run is on.
 */
export type MycelCatalogAction = CatalogActionBase & {
  readonly app: "Memory";
  readonly integration: "mycel";
};

/** One operation a workflow may call, with the risk level our team fixed for it. */
export type CatalogAction = GoogleCatalogAction | MycelCatalogAction;

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

/** What a workflow version needs, as the policy engine compares one version with the next. */
export type Requirements = {
  maxRisk: RiskLevel;
  /** The catalog actions the version calls. */
  requiredActions: readonly string[];
};

/**
 * What a new version needs that the previous one didn't: a higher max risk level, apps it
 * didn't use (as admins name them), scopes by short name (`gmail.modify`). Each is left out
 * when nothing was gained there.
 */
export type RequirementsGained = {
  maxRiskRaised?: { from: RiskLevel; to: RiskLevel };
  newApps?: ConnectionApp[];
  newScopes?: string[];
};
