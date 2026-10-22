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

/** One operation a workflow may call, with the risk level our team fixed for it. */
export type CatalogAction = {
  readonly kind: "catalog";
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
  /** What the action hands on to later steps, content included, never into a run record (ADR-0021). */
  readonly output: z.ZodType;
  /**
   * The fields of `output` a branch's condition may test (ADR-0015), each with its type, as
   * `{ from: "<step>.<name>" }`. An explicit list, so no ID becomes something to branch on.
   */
  readonly conditionFields?: readonly ConditionField[];
};

/** The HTTP methods a custom action's call may name; the risk rule refuses a DELETE. */
export const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

/**
 * The call a custom action makes, as far as its risk level goes (ADR-0018): an HTTP method, a
 * path on its app and the body fields it fills, or a GraphQL operation document sent to a path.
 * It never names a host.
 */
export type CustomCall =
  | { method: HttpMethod; path: string; body?: Readonly<Record<string, string>> }
  | { graphql: string; path: string };

/**
 * A custom action's call with where its inputs go and where its result fields come from: what
 * the runtime's one generic executor sends and reads back.
 */
export type CustomRequest = CustomCall & {
  /** Query parameter, by name, to the input that fills it. */
  readonly query: Readonly<Record<string, string>>;
  /** Body field (or GraphQL variable), by name, to the input that fills it. */
  readonly body: Readonly<Record<string, string>>;
  /** Result field, by name, to its dotted path into the response (`from.emailAddress.name`). */
  readonly outputs: Readonly<Record<string, string>>;
};

/**
 * A company's custom action (ADR-0018): one call to a registered app that the builder chat
 * described, with its risk level set by the fixed rule (`custom-risk.ts`). It is looked up and
 * checked like a catalog action.
 */
export type CustomAction = {
  readonly kind: "custom";
  readonly name: string;
  /** The registered app it calls, as admins name it ("Microsoft 365"). */
  readonly app: string;
  readonly description: string;
  readonly risk: RiskLevel;
  readonly pendingForm?: undefined;
  /** The registered app's ID, as `connections` names it. */
  readonly registeredApp: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly conditionFields?: readonly ConditionField[];
  readonly request: CustomRequest;
};

/** Any action in an action set: our catalog's, or one of the company's custom actions. */
export type Action = CatalogAction | CustomAction;

/**
 * The actions one company's workflows may use, resolved once per company (ADR-0018) and handed
 * to the policy engine and to everything else that looks an action up: the catalog, then the
 * company's custom actions.
 */
export type ActionSet = {
  /** Every action in the set, in order: the catalog's first. */
  readonly actions: readonly Action[];
  /** The action with this name, or undefined when the set has none. */
  find(name: string): Action | undefined;
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

/** What a workflow version needs, as the policy engine compares one version with the next. */
export type Requirements = {
  maxRisk: RiskLevel;
  /** The actions the version calls. */
  requiredActions: readonly string[];
};

/**
 * What a new version needs that the previous one didn't: a higher max risk level, apps it
 * didn't use (as admins name them), scopes by short name (`gmail.modify`). Each is left out
 * when nothing was gained there.
 */
export type RequirementsGained = {
  maxRiskRaised?: { from: RiskLevel; to: RiskLevel };
  newApps?: Action["app"][];
  newScopes?: string[];
};
