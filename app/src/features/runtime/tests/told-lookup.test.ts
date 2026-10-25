// A member's own run reads what they told Mycel (memory.lookup, as the member) until they delete
// it on "What I've told Mycel": from then on, its draft step never sees the note.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { deleteToldFact, tellFact } from "@/features/memory/server";
import { enable } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import {
  learnStoredItems,
  scriptLearning,
  scriptTelling,
  withCredits,
} from "@/testing/memory-learning";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { executeRun, startTriggeredRuns } from "../server";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const KEPT = "Dana Ruiz signs off orders over 5,000 pounds.";
const DELETED = "Dana Ruiz prefers a call to an email.";

const spec = {
  specVersion: 1,
  id: "customer-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    { id: "known", type: "tool", action: "memory.lookup", input: { about: "sender" } },
    {
      id: "draft",
      type: "draft",
      role: "fast",
      instructions: "Reply using what we know about the customer.",
      context: ["trigger.message", "known"],
      output: "google-mail.create-draft",
    },
    { id: "approve", type: "approval", channel: "gmail_drafts" },
  ],
  autonomy: { rung: 3 },
};

describe("memory.lookup after its member deletes a note", () => {
  it("drafts without the deleted note, and with the one they kept", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    const system = systemCtx(orgA.id);
    await withCredits(orgA.id);
    await connectGoogle(admin.ctx, admin.email);
    const box = await connectMailbox(member.ctx, member.email, [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [member.email],
        subject: "Oak chairs",
        text: "Hi, I lead procurement at Acme.",
        at: daysAgo(2),
      },
    ]);
    await backfillConnection(member.ctx, box.id);
    scriptLearning({
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
      facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
    });
    await learnStoredItems(orgA.id);
    const noteIds: string[] = [];
    for (const statement of [KEPT, DELETED]) {
      scriptTelling();
      const told = await tellFact(member.ctx, { about: { email: DANA }, statement });
      if (!told.saved) throw new Error("The note wasn't saved");
      noteIds.push(told.fact.id);
    }
    await deleteToldFact(member.ctx, noteIds[1] ?? "");
    await tagUsers(admin.ctx, "sales", [member]);
    const { workflowId } = await publishTo(admin.ctx, "Customer replies", spec, ["sales"]);
    await enable(member.ctx, workflowId);

    const { runIds } = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: box.id,
      sourceRef: box.mailbox.list(new URLSearchParams()).messages?.at(0)?.id ?? "",
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    fakeAiGateway.text("Thanks Dana, happy to help.");
    expect(await executeRun(system, runIds[0] ?? "")).toEqual({ status: "succeeded" });

    const draft = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(draft).toContain(ROLE);
    expect(draft).toContain(KEPT);
    expect(draft).not.toContain(DELETED);
  });
});
