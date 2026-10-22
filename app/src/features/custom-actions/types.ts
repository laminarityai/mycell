// The custom-actions feature's public types and schemas: a custom action's description as the
// builder chat writes it (ADR-0018), checked with Zod at the boundary, the record of one whose
// risk level the fixed rule set, and capability requests.
import { z } from "zod";
import { registeredAppIdSchema, type RegisteredAppId } from "@/features/connections/types";
import { httpMethodSchema, type RiskLevel } from "@/features/policy/types";
import type { ApiField, ApiOperation } from "./lib/api-index-types";

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

/**
 * Where each input goes: query parameter, or body field (GraphQL variable), to input name. A
 * body field is a dotted path of property names and list indexes
 * (`message.toRecipients.0.emailAddress.address`), so a nested body is described one scalar at a
 * time and a reviewer still reads each value; `description.ts` checks the paths make one body.
 */
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
    /** A read's result fields; a write's never reach the run, since it sends only once approved. */
    outputs: z.record(inputName, outputSchema).default({}),
    /** For a write: the text inputs a reviewer may edit before it's sent. */
    editable: z.array(inputName).default([]),
    risk: z.unknown().optional(),
  })
  .transform(
    (description) =>
      Object.fromEntries(Object.entries(description).filter(([key]) => key !== "risk")) as Omit<
        typeof description,
        "risk"
      >,
  );

export type CustomActionDescription = z.output<typeof customActionDescriptionSchema>;

/**
 * A custom action whose description passed every check, with the level the fixed rule set: what
 * a proposal carries, what's stored once accepted, and what the browser gets, as plain data.
 */
export type CustomActionRecord = CustomActionDescription & { risk: RiskLevel };

/**
 * A custom action in plain words, as a proposal card and the custom actions page show it: its
 * app, what it does, the call it makes and the level the fixed rule set.
 */
export type CustomActionWords = {
  name: string;
  /** The registered app, as admins name it. */
  app: string;
  description: string;
  /** The method and path, such as "GET /v1.0/me/messages/{messageId}". */
  call: string;
  risk: RiskLevel;
};

/** A company's custom action as its list shows it: who accepted it, when, from which proposal. */
export type StoredCustomAction = CustomActionRecord & {
  id: string;
  acceptedBy: string;
  acceptedAt: Date;
  proposalId: string | null;
};

/** Where a capability request stands, as our team sets it. */
export const capabilityRequestStatusSchema = z.enum(["open", "building", "shipped", "declined"]);
export type CapabilityRequestStatus = z.infer<typeof capabilityRequestStatusSchema>;

const fieldSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
});
/** One input or output of what a capability request asks for. */
export type CapabilityRequestField = z.infer<typeof fieldSchema>;

/**
 * What the builder chat files when one call can't do what the admin described (ADR-0018): the
 * builder tool's input, validated at that boundary.
 */
export const capabilityRequestInputSchema = z.object({
  app: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("A registered app's ID, or the name of an app that isn't registered."),
  operation: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("What Mycel would need to do there, in a few plain words: 'Merge two contacts'."),
  inputs: z.array(fieldSchema).max(20).describe("What it would take, each with a description."),
  outputs: z.array(fieldSchema).max(20).describe("What it would give back to later steps."),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("Why a catalog action or one call can't do it, in plain words."),
  codeDraft: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .optional()
    .describe("The call sequence or code it would need, as a starting point for our team."),
});
export type CapabilityRequestInput = z.infer<typeof capabilityRequestInputSchema>;

/** A capability request as its org's admins and our team see it. */
export type CapabilityRequest = {
  id: string;
  /** The registered app it's for (`id` set), or an unregistered app by name (`id` null). */
  app: { id: RegisteredAppId | null; name: string };
  operation: string;
  inputs: CapabilityRequestField[];
  outputs: CapabilityRequestField[];
  reason: string;
  codeDraft: string | null;
  /** How many times the builder chat asked for it. */
  count: number;
  /** The builder conversations it was asked from, first asked first. */
  conversationIds: string[];
  status: CapabilityRequestStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** What filing tells the builder chat: the request and whether it was asked for before. */
export type FiledCapabilityRequest = {
  requestId: string;
  count: number;
  status: CapabilityRequestStatus;
  message: string;
};

/**
 * What the builder chat's API lookup takes: a registered app, then plain words to search its
 * API description by (optionally one HTTP method), or one of its types by name.
 */
export const apiLookupInputSchema = z
  .strictObject({
    app: registeredAppIdSchema,
    search: z.string().min(1).optional(),
    method: httpMethodSchema.optional(),
    type: z.string().min(1).optional(),
  })
  .refine((input) => (input.search === undefined) !== (input.type === undefined), {
    message: "Pass either search (plain words) or type (a type's name), not both.",
  });
export type ApiLookupInput = z.infer<typeof apiLookupInputSchema>;

/** A type as the lookup shows it: its name, what it is, and its fields, one level deep. */
export type ApiTypeShown = {
  type: string;
  description?: string;
  fields: ApiField[];
  /** How many more fields it has than are shown. */
  moreFields?: number;
};

export type FoundOperation = Omit<ApiOperation, "body" | "response"> & {
  /** What the fixed risk rule makes of a custom action making this call. */
  rule: string;
  body?: ApiTypeShown;
  response?: ApiTypeShown;
  /** For a list response (Graph's `value`): each item's type. */
  eachItem?: ApiTypeShown;
};

export type ApiLookupResult =
  | { app: RegisteredAppId; search: string; operations: FoundOperation[] }
  | { app: RegisteredAppId; type: ApiTypeShown | null; message?: string };
