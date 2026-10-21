// The spec as it was before branches had paths (`specVersion: 1`): one list of steps, where a
// branch only lets the run go on or ends it. Working specs and proposals keep this shape until
// they're saved again, and workflow versions keep it for good. `upgrade.ts` reads it as the
// current version. Pure, so client code may import it.
import { z } from "zod";
import {
  approvalStep,
  classifyStep,
  draftStep,
  escalateStep,
  extractStep,
  specObject,
  specSettings,
  stepBase,
  stepId,
  toolStep,
} from "./types";

/** Goes on when `when.step` gave `when.label` with probability at least `when.minP`. */
const gateStep = specObject({
  ...stepBase,
  type: z.literal("branch"),
  when: specObject({ step: stepId, label: z.string().min(1), minP: z.number().min(0).max(1) }),
  else: z.enum(["stop", "escalate"]),
});

const stepV1Schema = z.discriminatedUnion("type", [
  classifyStep,
  gateStep,
  extractStep,
  toolStep,
  draftStep,
  approvalStep,
  escalateStep,
]);
export type StepV1 = z.infer<typeof stepV1Schema>;
export type GateStep = z.infer<typeof gateStep>;

export const specV1Schema = specObject({
  specVersion: z.literal(1),
  ...specSettings,
  steps: z.array(stepV1Schema).min(1),
});
export type SpecV1 = z.infer<typeof specV1Schema>;
