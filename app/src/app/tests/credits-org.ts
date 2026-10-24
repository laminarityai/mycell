// An org for the Credits page's tests: a grant, and published workflows whose runs spent credits
// through the ledger, as the gateway client records them.
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, recordUsage } from "@/features/credits/server";
import { archiveWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { connectGmail } from "@/testing/connect-helpers";

const labelSpec = (id: string, monthlyCredits?: number) => ({
  specVersion: 1,
  id,
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "label",
      type: "tool",
      action: "google-mail.add-label",
      input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
    },
  ],
  autonomy: { rung: 3 },
  ...(monthlyCredits === undefined ? {} : { budget: { monthlyCredits } }),
});

/** Saves and publishes a label workflow, under a monthly budget if given one. */
export async function publish(admin: Ctx, name: string, id: string, monthlyCredits?: number) {
  const saved = await saveWorkflow(admin, { name, spec: labelSpec(id, monthlyCredits) });
  await publishWorkflow(admin, saved.id);
  return saved.id;
}

/** A run's model call that cost `credits`, as the gateway client records it. */
export async function run(orgId: string, workflowId: string, credits: number, runId = "run_1") {
  await recordUsage(systemCtx(orgId), {
    role: "fast",
    modelId: "openai/x",
    costUsd: credits / 1000,
    outcome: "succeeded",
    workflowId,
    runId,
  });
}

/**
 * Org A granted 1,000 credits, with four workflows, three of which ran (40 credits in all), one
 * past its budget of 20, and an archived one.
 */
export async function orgWithWorkflows() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
  const quotes = await publish(admin, "Quote replies", "quotes", 20);
  const invoices = await publish(admin, "Invoices", "invoices", 500);
  const calls = await publish(admin, "Call notes", "calls");
  const idle = await publish(admin, "Status updates", "status", 100);
  const archived = await publish(admin, "Old", "old", 100);
  await archiveWorkflow(admin, archived);
  await run(orgA.id, quotes, 25);
  await run(orgA.id, invoices, 5);
  await run(orgA.id, calls, 10);
  return { orgA, admin, idle, quotes };
}

/** An org with `count` budgeted workflows, each with two runs this month. */
export async function orgWithManyWorkflows(count: number) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGmail(admin, orgA.admin.email);
  await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
  for (let n = 0; n < count; n += 1) {
    const id = await publish(admin, `Workflow ${String(n)}`, `wf-${String(n)}`, 100);
    await run(orgA.id, id, 2, `run_${String(n)}_a`);
    await run(orgA.id, id, 3, `run_${String(n)}_b`);
  }
  return admin;
}

/** The text of rendered HTML, its tags removed. */
export const textOf = (html: string) => html.replace(/<[^>]+>/g, "");
