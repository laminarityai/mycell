// The workflow contract (docs/architecture.md, "Workflow spec"): the Zod schema for
// `specVersion: 2`, where a branch holds its paths (ADR-0015). This is shape only; `validate.ts`
// adds the rules that span steps. Specs from before are read through `upgrade.ts`.
import { z } from "zod";

/**
 * Every object in a spec may carry a `risk` field (a model may propose one), which is accepted
 * and ignored: only the catalog decides a risk level (invariant 4). Any other unknown key is
 * refused, so a misspelled field is named rather than dropped.
 */
export function specObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject({ ...shape, risk: z.unknown().optional() });
}

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens.");

/**
 * A step ID, also a path's: steps and paths share one namespace across the spec. `trigger` is
 * reserved for references to the triggering event.
 */
export const stepId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "Start with a letter; use lowercase letters, digits, - and _.")
  .refine((id) => id !== "trigger", "`trigger` is reserved for the triggering event.");

/** Model roles: code and specs name one instead of a model (invariant 6). */
export const modelRoleSchema = z.enum(["classify", "fast", "smart", "judge", "embed"]);
export type ModelRole = z.infer<typeof modelRoleSchema>;

/** The roles a step may name: every role but `embed`, whose model only turns text into vectors. */
export const stepModelRoleSchema = modelRoleSchema.exclude(["embed"]);
export type StepModelRole = z.infer<typeof stepModelRoleSchema>;

/** A catalog action's name. `policy` checks that it exists; the spec only names it. */
const actionName = z.string().min(1);

/** A value read from an earlier step's output or from the trigger: `<stepId>.<field>`. */
export const referenceSchema = specObject({
  from: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*\.[A-Za-z0-9_.-]+$/, "Write a reference as `<step>.<field>`."),
});
export type Reference = z.infer<typeof referenceSchema>;

const literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const inputValue = z.union([
  literal,
  referenceSchema,
  z.array(z.union([literal, referenceSchema])),
]);

export const jsonSchemaTypes = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;
export type JsonSchemaType = (typeof jsonSchemaTypes)[number];

/**
 * The JSON Schema keywords a `schema` check may use. Any other keyword is refused, so a check
 * never silently ignores part of what it was written to enforce.
 */
export type JsonSchemaSubset = {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  properties?: Record<string, JsonSchemaSubset>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaSubset;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

const jsonType = z.enum(jsonSchemaTypes);
const count = z.number().int().min(0);

export const jsonSchemaSubset: z.ZodType<JsonSchemaSubset> = z.strictObject({
  type: z.union([jsonType, z.array(jsonType).min(1)]).optional(),
  description: z.string().optional(),
  enum: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .min(1)
    .optional(),
  get properties() {
    return z.record(z.string(), jsonSchemaSubset).optional();
  },
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
  get items() {
    return jsonSchemaSubset.optional();
  },
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: count.optional(),
  maxLength: count.optional(),
  minItems: count.optional(),
  maxItems: count.optional(),
});

/** Optional checks on a step's output; a failed check fails the step without a retry. */
const checksSchema = specObject({
  schema: jsonSchemaSubset.optional(),
  minP: z.number().min(0).max(1).optional(),
  requiredFields: z.array(z.string().min(1)).optional(),
});

export const stepBase = { id: stepId, checks: checksSchema.optional() };

export const classifyStep = specObject({
  ...stepBase,
  type: z.literal("classify"),
  role: stepModelRoleSchema,
  question: z.string().min(1),
  labels: z.array(z.string().min(1)).min(2).max(10),
});

export const extractStep = specObject({
  ...stepBase,
  type: z.literal("extract"),
  role: stepModelRoleSchema,
  fields: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Name a field with letters, digits and _."),
      specObject({ type: z.enum(["string", "number", "boolean"]), description: z.string() }),
    )
    .refine((fields) => Object.keys(fields).length > 0, "Name at least one field."),
});

export const toolStep = specObject({
  ...stepBase,
  type: z.literal("tool"),
  action: actionName,
  input: z.record(z.string(), inputValue).default({}),
});

/** Context a draft reads: earlier step IDs, `trigger.message` or `trigger.thread`. */
export const draftStep = specObject({
  ...stepBase,
  type: z.literal("draft"),
  role: stepModelRoleSchema,
  instructions: z.string().min(1),
  context: z.array(z.string().min(1)).default([]),
  output: actionName,
});

/**
 * Where a person reviews what waits: `gmail_drafts`, the Gmail drafts the draft steps above it
 * made; `held_send`, the requests of the custom writes above it, which Mycel holds until a person
 * approves them (ADR-0020).
 */
export const approvalChannels = ["gmail_drafts", "held_send"] as const;
export type ApprovalChannel = (typeof approvalChannels)[number];

export const approvalStep = specObject({
  ...stepBase,
  type: z.literal("approval"),
  channel: z.enum(approvalChannels),
});

export const escalateStep = specObject({
  ...stepBase,
  type: z.literal("escalate"),
  reason: z.string().min(1),
});

/** Holds when the classify step `classify` gave the label `is` with probability at least `minP`. */
const classifyCheck = specObject({
  classify: stepId,
  is: z.string().min(1),
  minP: z.number().min(0).max(1),
});

/** The operators a check on a value may use, by the type of the value. */
export const checkOperators = {
  text: ["is", "is_not", "contains", "does_not_contain", "starts_with", "ends_with"],
  number: ["equals", "does_not_equal", "more_than", "less_than", "at_least", "at_most"],
  yesNo: ["is_yes", "is_no"],
  any: ["is_empty", "is_not_empty"],
} as const;

/** The type of a value a check tests, which decides the operators it may use. */
export type ValueType = Exclude<keyof typeof checkOperators, "any">;

/**
 * A field a condition may test, as what declares it gives it: a trigger's fact, or a catalog
 * action's result field (ADR-0015). `label` names it in an admin's words.
 */
export type ConditionField = { name: string; type: ValueType; label: string };

// A check on a value read from above the branch (`{ from: "<step>.<field>" }`) or from the
// trigger (`{ from: "trigger.<fact>" }`). The operator decides what `value` is: text for a text
// check, a number for a number check, and none for a yes/no or an empty check.
const textCheck = specObject({
  subject: referenceSchema,
  op: z.enum(checkOperators.text),
  value: z.string(),
});
const numberCheck = specObject({
  subject: referenceSchema,
  op: z.enum(checkOperators.number),
  value: z.number(),
});
const valuelessCheck = specObject({
  subject: referenceSchema,
  op: z.enum([...checkOperators.yesNo, ...checkOperators.any]),
});

export const checkSchema = z.union([classifyCheck, textCheck, numberCheck, valuelessCheck]);
export type Check = z.infer<typeof checkSchema>;

/** Holds when all of its checks hold, or any of them. */
export const conditionSchema = specObject({
  combine: z.enum(["all", "any"]),
  // A path that always runs is what the otherwise path is for.
  checks: z
    .array(checkSchema)
    .min(1, "Give the condition at least one check; the otherwise path takes the rest."),
});
export type Condition = z.infer<typeof conditionSchema>;

/** One way out of a branch: its condition, and the steps a message follows when it holds. */
const pathSchema = z.strictObject({
  id: stepId,
  name: z.string().trim().min(1, "Name the path."),
  condition: conditionSchema,
  get steps(): z.ZodArray<typeof stepSchema> {
    return z.array(stepSchema);
  },
  risk: z.unknown().optional(),
});
export type Path = z.infer<typeof pathSchema>;

/** The path a message follows when no other applies. With no steps, the run stops there. */
const otherwiseSchema = z.strictObject({
  id: stepId,
  get steps(): z.ZodArray<typeof stepSchema> {
    return z.array(stepSchema);
  },
  risk: z.unknown().optional(),
});
export type OtherwisePath = z.infer<typeof otherwiseSchema>;

/** A branch's paths, at most, not counting its otherwise path; and how deep branches nest. */
export const MAX_PATHS = 10;
export const MAX_BRANCH_DEPTH = 3;

/**
 * Splits the workflow into paths (ADR-0015). First match runs the first path, left to right,
 * whose condition holds; every match runs each that holds, one after another. The otherwise
 * path runs when none does. A branch is the last step of its list: paths never join back up.
 */
const branchStep = z.strictObject({
  ...stepBase,
  type: z.literal("branch"),
  mode: z.enum(["first", "every"]).default("first"),
  get paths(): z.ZodArray<typeof pathSchema> {
    return z
      .array(pathSchema)
      .min(1, "Give the branch at least one path.")
      .max(MAX_PATHS, `A branch has at most ${String(MAX_PATHS)} paths, besides otherwise.`);
  },
  get otherwise(): typeof otherwiseSchema {
    return otherwiseSchema;
  },
  risk: z.unknown().optional(),
});
export type BranchStep = z.infer<typeof branchStep>;

export const stepSchema = z.discriminatedUnion("type", [
  classifyStep,
  branchStep,
  extractStep,
  toolStep,
  draftStep,
  approvalStep,
  escalateStep,
]);
export type Step = z.infer<typeof stepSchema>;
export type StepType = Step["type"];

/** Every step type, for registries that must cover them all (the runtime's executors). */
export const stepTypes: readonly StepType[] = stepSchema.options.map(
  (option) => option.shape.type.value,
);

/** A spec's fields other than its version and its steps, alike in every version. */
export const specSettings = {
  id: slug,
  credentials: z.enum(["member", "org"]),
  trigger: specObject({
    type: z.literal("gmail.message_received"),
    labelIds: z.array(z.string().min(1)).min(1).default(["INBOX"]),
  }),
  autonomy: specObject({ rung: z.union([z.literal(0), z.literal(3), z.literal(4)]) }),
  // Accepted and stored, unused until M7.
  budget: specObject({ monthlyCredits: z.number().int().positive().optional() }).optional(),
  // The names of the tags it's published to (M5): members with any of them see it. Publishing
  // resolves the names to the org's tags and refuses one no tag has.
  visibility: specObject({ tags: z.array(z.string().min(1)) }).optional(),
  // Whether whoever may act on one of its reviews may hand it to a colleague (ADR-0013). Off
  // unless the spec says so; not a risk change, since nothing more is sent.
  review: specObject({ handoff: z.boolean().default(false) }).optional(),
};

export const specSchema = specObject({
  specVersion: z.literal(2),
  ...specSettings,
  steps: z.array(stepSchema).min(1),
});

/** A spec that passed `validateSpec`. */
export type Spec = z.infer<typeof specSchema>;

/** One reason a spec is refused, at the path of the field it's about. */
export type SpecIssue = { path: (string | number)[]; message: string };

export type SpecValidation = { ok: true; spec: Spec } | { ok: false; issues: SpecIssue[] };
