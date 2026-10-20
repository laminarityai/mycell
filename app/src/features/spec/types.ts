// The workflow contract (docs/architecture.md, "Workflow spec"): the Zod schema for
// `specVersion: 1`. This is shape only; `validate.ts` adds the rules that span steps.
import { z } from "zod";

/**
 * Every object in a spec may carry a `risk` field (a model may propose one), which is accepted
 * and ignored: only the catalog decides a risk level (invariant 4). Any other unknown key is
 * refused, so a misspelled field is named rather than dropped.
 */
function specObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject({ ...shape, risk: z.unknown().optional() });
}

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens.");

/** A step ID. `trigger` is reserved for references to the triggering event. */
const stepId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "Start with a letter; use lowercase letters, digits, - and _.")
  .refine((id) => id !== "trigger", "`trigger` is reserved for the triggering event.");

/** Model roles a step names instead of a model (invariant 6). */
export const modelRoleSchema = z.enum(["classify", "fast", "smart", "judge"]);
export type ModelRole = z.infer<typeof modelRoleSchema>;

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

const stepBase = { id: stepId, checks: checksSchema.optional() };

const classifyStep = specObject({
  ...stepBase,
  type: z.literal("classify"),
  role: modelRoleSchema,
  question: z.string().min(1),
  labels: z.array(z.string().min(1)).min(2).max(10),
});

/** Goes on when `when.step` gave `when.label` with probability at least `when.minP`. */
const branchStep = specObject({
  ...stepBase,
  type: z.literal("branch"),
  when: specObject({ step: stepId, label: z.string().min(1), minP: z.number().min(0).max(1) }),
  else: z.enum(["stop", "escalate"]),
});

const extractStep = specObject({
  ...stepBase,
  type: z.literal("extract"),
  role: modelRoleSchema,
  fields: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Name a field with letters, digits and _."),
      specObject({ type: z.enum(["string", "number", "boolean"]), description: z.string() }),
    )
    .refine((fields) => Object.keys(fields).length > 0, "Name at least one field."),
});

const toolStep = specObject({
  ...stepBase,
  type: z.literal("tool"),
  action: actionName,
  input: z.record(z.string(), inputValue).default({}),
});

/** Context a draft reads: earlier step IDs, `trigger.message` or `trigger.thread`. */
const draftStep = specObject({
  ...stepBase,
  type: z.literal("draft"),
  role: modelRoleSchema,
  instructions: z.string().min(1),
  context: z.array(z.string().min(1)).default([]),
  output: actionName,
});

/** In v1 a person approves by sending the Gmail draft. */
const approvalStep = specObject({
  ...stepBase,
  type: z.literal("approval"),
  channel: z.literal("gmail_drafts"),
});

const escalateStep = specObject({
  ...stepBase,
  type: z.literal("escalate"),
  reason: z.string().min(1),
});

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

export const specSchema = specObject({
  specVersion: z.literal(1),
  id: slug,
  credentials: z.enum(["member", "org"]),
  trigger: specObject({
    type: z.literal("gmail.message_received"),
    labelIds: z.array(z.string().min(1)).min(1).default(["INBOX"]),
  }),
  steps: z.array(stepSchema).min(1),
  autonomy: specObject({ rung: z.union([z.literal(0), z.literal(3), z.literal(4)]) }),
  // Accepted and stored, unused until M5 (visibility) and M7 (budget).
  budget: specObject({ monthlyCredits: z.number().int().positive().optional() }).optional(),
  visibility: specObject({ tags: z.array(z.string().min(1)) }).optional(),
});

/** A spec that passed `validateSpec`. */
export type Spec = z.infer<typeof specSchema>;

/** One reason a spec is refused, at the path of the field it's about. */
export type SpecIssue = { path: (string | number)[]; message: string };

export type SpecValidation = { ok: true; spec: Spec } | { ok: false; issues: SpecIssue[] };
