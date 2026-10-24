// The Runs page tests' company: who has which inbox, two workflows, and runs ending as asked.
import { expect } from "vitest";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { executeRun, startRun } from "../server";
import type { RunStatus } from "../types";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

/** Reads the message that started the run. */
export const readStep = {
  id: "read",
  type: "tool",
  action: "google-mail.read-message",
  input: { messageId: { from: "trigger.messageId" } },
};

/**
 * Org A's admin and member each with their own inbox, and a shared sales inbox; a member
 * workflow and an org workflow that read the message. The member is promoted for starting runs
 * by hand on their own inbox, which only admins may.
 */
export async function company() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const member = orgA.member.ctx;
  const promoted: Ctx = { ...member, role: "admin" };
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const own = await connectInbox(admin, orgA.admin.email, [
    pricingQuestion({ subject: "Own question" }),
  ]);
  const colleague = await connectInbox(member, orgA.member.email, [
    pricingQuestion({ subject: "MARKER-colleague-subject" }),
  ]);
  const sales = `sales@${orgA.workspaceDomain}`;
  const shared = await connectMailbox(admin, sales, [], "org");
  const orgMessage = shared.mailbox.add(pricingQuestion({ subject: "Shared question" }));
  const memberWorkflow = await publish(admin, threadSpec({ id: "replies", steps: [readStep] }));
  const orgWorkflow = await publish(
    admin,
    threadSpec({ id: "sales", credentials: "org", steps: [readStep] }),
  );
  // Runs one message, ending as `status` asks: a missing message fails its read.
  const run = async (on: "own" | "colleague" | "org", status: RunStatus) => {
    const [ctx, connectionId, message, workflowId] =
      on === "own"
        ? [admin, own.connectionId, own.messages[0], memberWorkflow]
        : on === "colleague"
          ? [promoted, colleague.connectionId, colleague.messages[0], memberWorkflow]
          : [admin, shared.id, orgMessage, orgWorkflow];
    const sourceRef = status === "failed" ? `missing-${on}` : message.id;
    const { runId } = await startRun(ctx, workflowId, connectionId, sourceRef);
    if (status !== "running") expect(await executeRun(system, runId)).toEqual({ status });
    return runId;
  };
  return {
    orgA,
    admin,
    member,
    own,
    colleague,
    shared,
    sales,
    orgMessage,
    memberWorkflow,
    orgWorkflow,
    run,
  };
}
