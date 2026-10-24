// The triggering item, read inside the step that needs it and held in memory only (invariant
// 8): its facts a branch's checks test (`spec/triggers.ts`), never in the step's output or
// record, which keep the path taken and each check's pass or fail; and its text, for a model
// step. The item is a Gmail message or a calendar invite, as the spec's trigger says.
import { subjectParts } from "@/features/spec/conditions";
import type { BranchStep } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";
import { inviteFacts, inviteText } from "./calendar";
import { messageFacts, messageText } from "./gmail";
import type { StepContext } from "./step-context";

/**
 * The outputs above `branch`, plus the triggering item's facts under `trigger` when one of
 * its checks tests one (`trigger` is reserved, so no step's output is there). The item is read
 * only then.
 */
export async function withTriggerFacts(
  branch: BranchStep,
  context: StepContext,
): Promise<Readonly<Record<string, Json>>> {
  const tested = branch.paths.some((path) =>
    path.condition.checks.some(
      (check) => !("classify" in check) && subjectParts(check.subject.from).source === "trigger",
    ),
  );
  if (!tested) return context.outputs;
  const { ctx, run, spec } = context;
  const facts =
    spec.trigger.type === "calendar.invite_received"
      ? await inviteFacts(ctx, run.connectionId, run.sourceRef)
      : await messageFacts(ctx, run.connectionId, run.sourceRef);
  return { ...context.outputs, trigger: facts };
}

/** The triggering item as a model reads it: the message, or the invite. */
export async function triggerText(context: StepContext): Promise<string> {
  const { ctx, run, spec } = context;
  return spec.trigger.type === "calendar.invite_received"
    ? inviteText(ctx, run.connectionId, run.sourceRef)
    : messageText(ctx, run.connectionId, run.sourceRef);
}
