// The custom-actions feature's public types: a custom action's description as the builder chat
// writes it (ADR-0018), checked with Zod at the boundary, and the record of one whose risk level
// the fixed rule set.
import { z } from "zod";
import { registeredAppIdSchema } from "@/features/connections/types";
import { httpMethodSchema, type RiskLevel } from "@/features/policy/types";

/** `microsoft.read-message`: the app's word, a dot, then what it does. Unique in the org. */
export const customActionNameSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/,
    "Name it like microsoft.read-message: lowercase words joined by hyphens, after the app's word and a dot.",
  );

const inputName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Name an input with letters, digits and _.");

/** The types an input or a result field may have: text, a number, yes/no, or a choice. */
export const customValueTypeSchema = z.enum(["text", "number", "yes_no", "choice"]);
export type CustomValueType = z.infer<typeof customValueTypeSchema>;

const inputSchema = z.strictObject({
  type: customValueTypeSchema,
  description: z.string().min(1),
  /** A choice input's options. */
  choices: z.array(z.string().min(1)).min(1).optional(),
  optional: z.boolean().default(false),
});

const outputSchema = z.strictObject({
  type: customValueTypeSchema.exclude(["choice"]),
  /** What it holds, in an admin's words, as a branch's condition names it. */
  label: z.string().min(1),
  /** Where it is in the response: property names and list indexes, joined by dots. */
  path: z
    .string()
    .regex(/^[A-Za-z0-9_@$-]+(\.[A-Za-z0-9_@$-]+)*$/, "Write a path like from.emailAddress.name."),
});

/** Where each input goes: query parameter or body field (GraphQL variable) to input name. */
const mapping = z.record(z.string().min(1), inputName).default({});

const restCall = z.strictObject({
  method: httpMethodSchema,
  /** The path on the app, never its host, with `{input}` placeholders. */
  path: z.string().min(1),
  query: mapping,
  body: mapping,
});

const graphqlCall = z.strictObject({
  /** One operation document, sent with its variables to `path`. */
  graphql: z.string().min(1),
  path: z.string().min(1),
  variables: mapping,
});

/**
 * A custom action as the builder chat describes it: one call to a registered app, its inputs and
 * its typed result fields. A `risk` it proposes is accepted and dropped: only the fixed rule
 * sets a level (invariant 4).
 */
export const customActionDescriptionSchema = z
  .strictObject({
    name: customActionNameSchema,
    app: registeredAppIdSchema,
    /** What it does, in a sentence an admin and the builder chat read. */
    description: z.string().min(1),
    call: z.union([restCall, graphqlCall]),
    inputs: z.record(inputName, inputSchema).default({}),
    outputs: z
      .record(inputName, outputSchema)
      .refine((outputs) => Object.keys(outputs).length > 0, "Name at least one result field."),
    /** For a write: the text inputs a reviewer may edit before it's sent. */
    editable: z.array(inputName).default([]),
    risk: z.unknown().optional(),
  })
  .transform(({ risk: _ignored, ...description }) => description);

export type CustomActionDescription = z.output<typeof customActionDescriptionSchema>;

/**
 * A custom action whose description passed every check, with the level the fixed rule set: what
 * a proposal carries, what's stored once accepted, and what the browser gets, as plain data.
 */
export type CustomActionRecord = CustomActionDescription & { risk: RiskLevel };

/** A company's custom action as its list shows it: who accepted it, when, from which proposal. */
export type StoredCustomAction = CustomActionRecord & {
  id: string;
  acceptedBy: string;
  acceptedAt: Date;
  proposalId: string | null;
};
