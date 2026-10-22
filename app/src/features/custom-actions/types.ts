// The custom-actions feature's public types and schemas.
import { z } from "zod";
import type { RegisteredAppId } from "@/features/connections/types";

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
