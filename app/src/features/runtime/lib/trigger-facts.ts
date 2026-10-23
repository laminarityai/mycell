// The trigger's facts a branch's checks test (`spec/triggers.ts`), read through the Nango proxy
// inside the branch step and held in memory only (invariant 8): never in the step's output or
// record, which keep the path taken and each check's pass or fail.
import { subjectParts } from "@/features/spec/conditions";
import type { BranchStep } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";
import { messageFacts } from "./gmail";
import type { StepContext } from "./step-context";

/**
 * The outputs above `branch`, plus the triggering message's facts under `trigger` when one of
 * its checks tests one (`trigger` is reserved, so no step's output is there). The message is
 * read only then.
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
  const { ctx, run } = context;
  const facts = await messageFacts(ctx, run.connectionId, run.sourceRef);
  return { ...context.outputs, trigger: facts };
}
