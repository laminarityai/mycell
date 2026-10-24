// Paused workflows for any feature's tests (admins' alerts and their page), through workflows'
// and credits' real paths: a label workflow published, paused after three failed runs, or
// spending its budget in live runs.
import { recordUsage } from "@/features/credits/server";
import { pauseForFailures, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";

/** Classify, then label the message: a spec any admin with a Gmail connection can publish. */
export function labelSpec(id: string, monthlyCredits?: number): Record<string, unknown> {
  return {
    specVersion: 1,
    id,
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "classify",
        type: "classify",
        role: "classify",
        question: "Is this a pricing inquiry?",
        labels: ["yes", "no"],
      },
      {
        id: "label",
        type: "tool",
        action: "google-mail.add-label",
        input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
      },
    ],
    autonomy: { rung: 3 },
    ...(monthlyCredits === undefined ? {} : { budget: { monthlyCredits } }),
  };
}

/** The spec ID `name` gets: "Pricing labels" is "pricing-labels". */
export const specIdOf = (name: string) => name.toLowerCase().replaceAll(" ", "-");

/** Publishes a label workflow called `name`, with a monthly budget if one is given. */
export async function publishLabels(
  admin: Ctx,
  name: string,
  monthlyCredits?: number,
): Promise<string> {
  const { id } = await saveWorkflow(admin, {
    name,
    spec: labelSpec(specIdOf(name), monthlyCredits),
  });
  await publishWorkflow(admin, id);
  return id;
}

/** Pauses the workflow as runtime does after its third failed run in a row. */
export async function pauseFailing(orgId: string, workflowId: string): Promise<void> {
  await pauseForFailures(systemCtx(orgId), workflowId, ["run-3", "run-2", "run-1"]);
}

/** What the workflow's live runs spend now: `credits`, as a run's model call records it. */
export async function spendOn(orgId: string, workflowId: string, credits: number): Promise<void> {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    workflowId,
    runId: `run-${workflowId}`,
  });
}
