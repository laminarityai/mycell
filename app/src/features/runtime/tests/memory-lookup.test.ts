// The memory.lookup action (ADR-0023): a run reads memory in the view of whoever it acts for,
// the enabling member on member credentials and no one (company-wide facts only) on org
// credentials. Its facts reach a later draft step but never the run's records.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { listAccessLog, markCompanyWideList, tellFact } from "@/features/memory/server";
import { enable } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import {
  learnStoredItems,
  scriptLearning,
  scriptTelling,
  withCredits,
  type ScriptedExtraction,
} from "@/testing/memory-learning";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { dryRun, executeRun, startRun, startTriggeredRuns } from "../server";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const DEMO = "Dana Ruiz asked for a demo of the oak range.";
const OFFICES = "Acme has offices in Leeds and York.";
const REPLY = "Thanks Dana, happy to help with Acme's order.";
// Notes people told Mycel about Dana: each is its teller's own.
const MEMBER_NOTE = "Dana Ruiz prefers a call to an email.";
const COLLEAGUE_NOTE = "Dana Ruiz is negotiating a discount.";

const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };
const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };

const learnings: Record<string, ScriptedExtraction> = {
  role: {
    objects: [dana],
    facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
  },
  demo: {
    objects: [dana],
    facts: [{ about: "dana", statement: DEMO, evidence: "Could we see a demo of the oak range?" }],
  },
  offices: {
    objects: [acme],
    facts: [{ about: "acme", statement: OFFICES, evidence: "our offices in Leeds and York" }],
  },
};

const fromDana = (to: string, text: string): FakeMessageInput => ({
  from: `Dana Ruiz <${DANA}>`,
  to: [to],
  subject: "Oak chairs",
  text,
  at: daysAgo(2),
});

/** Connects `ctx`'s mailbox (or an org inbox), holding one email, and learns `learned` from it. */
async function mailboxLearning(
  org: FixtureOrg,
  ctx: Ctx,
  address: string,
  text: string,
  learned: ScriptedExtraction,
  kind: "member" | "org" = "member",
) {
  const box = await connectMailbox(ctx, address, [fromDana(address, text)], kind);
  await backfillConnection(ctx, box.id);
  scriptLearning(learned);
  await learnStoredItems(org.id);
  const sourceRef = box.mailbox.list(new URLSearchParams()).messages?.at(0)?.id ?? "";
  return { ...box, sourceRef };
}

/** Looks Dana up, then drafts a reply that reads what was found. */
function lookupSpec(credentials: "member" | "org", input: Record<string, unknown>) {
  return {
    specVersion: 1,
    id: "customer-replies",
    credentials,
    trigger: { type: "gmail.message_received" },
    steps: [
      { id: "known", type: "tool", action: "memory.lookup", input },
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
}

/** What the draft step sent the model. */
const draftPrompt = () => JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);

describe("memory.lookup in a member-credential run", () => {
  it("drafts with the facts its member can see, never a colleague's", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    const system = systemCtx(orgA.id);
    await withCredits(orgA.id);
    const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    await connectGoogle(admin.ctx, admin.email);
    const memberBox = await mailboxLearning(
      orgA,
      member.ctx,
      member.email,
      "Hi, I lead procurement at Acme.",
      learnings.role,
    );
    // Lee's private email: the member isn't on it.
    await mailboxLearning(
      orgA,
      lee.ctx,
      lee.email,
      "Could we see a demo of the oak range?",
      learnings.demo,
    );
    // The member's own note about Dana, and Lee's.
    for (const [ctx, statement] of [
      [member.ctx, MEMBER_NOTE],
      [lee.ctx, COLLEAGUE_NOTE],
    ] as const) {
      scriptTelling();
      await tellFact(ctx, { about: { email: DANA }, statement });
    }
    await tagUsers(admin.ctx, "sales", [member]);
    const spec = lookupSpec("member", { about: "sender" });
    const { workflowId } = await publishTo(admin.ctx, "Customer replies", spec, ["sales"]);
    await enable(member.ctx, workflowId);

    const { runIds } = await startTriggeredRuns(system, {
      orgId: orgA.id,
      connectionId: memberBox.id,
      sourceRef: memberBox.sourceRef,
      occurredAt: new Date().toISOString(),
      labelIds: ["INBOX"],
    });
    const runId = runIds[0] ?? "";
    fakeAiGateway.text(REPLY);
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect(draftPrompt()).toContain(ROLE);
    expect(draftPrompt()).not.toContain(DEMO);
    expect(draftPrompt()).toContain(MEMBER_NOTE);
    expect(draftPrompt()).not.toContain(COLLEAGUE_NOTE);
    // The facts passed to the draft step, but the run's records keep none of them.
    expect(await tablesHolding(ROLE)).not.toContain("run_steps");
    const [read] = await listAccessLog(admin.ctx);
    expect(read).toMatchObject({
      operation: "search",
      reader: { kind: "workflow_run", userId: member.id, runId, workflowId },
      factCount: 2,
    });
  });
});

describe("memory.lookup in an org-credential run", () => {
  it("sees only company-wide facts", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const system = systemCtx(orgA.id);
    await withCredits(orgA.id);
    const support = `support@${orgA.workspaceDomain}`;
    const inbox = await mailboxLearning(
      orgA,
      admin.ctx,
      support,
      "Hi, I lead procurement at Acme.",
      learnings.role,
      "org",
    );
    // The admin's own private email: an org-credential run is no one, so it can't see it.
    await mailboxLearning(
      orgA,
      admin.ctx,
      admin.email,
      "Could we see a demo of the oak range?",
      learnings.demo,
    );
    // The admin's own note: an org-credential run is no one, so it can't see it either.
    scriptTelling();
    await tellFact(admin.ctx, { about: { email: DANA }, statement: MEMBER_NOTE });
    const { workflowId } = await publishTo(
      admin.ctx,
      "Support replies",
      lookupSpec("org", { about: "sender" }),
      [],
    );

    const { runId } = await startRun(admin.ctx, workflowId, inbox.id, inbox.sourceRef);
    fakeAiGateway.text(REPLY);
    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect(draftPrompt()).toContain(ROLE);
    expect(draftPrompt()).not.toContain(DEMO);
    expect(draftPrompt()).not.toContain(MEMBER_NOTE);
    const [read] = await listAccessLog(admin.ctx);
    expect(read).toMatchObject({
      reader: { kind: "workflow_run", userId: null, runId, workflowId },
      factCount: 1,
    });
  });
});

describe("memory.lookup with a fact from outside that contradicts the company's", () => {
  it("hands the draft both, the outside one marked disputed", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    await withCredits(orgA.id);
    const billing = "Acme's billing contact is billing@acme.example.";
    const changed = "Acme's billing contact is now pay@other.example.";
    const all = `all@${orgA.workspaceDomain}`;
    await markCompanyWideList(admin.ctx, all);
    // The admin tells all@ who Acme's billing contact is.
    const adminBox = await connectMailbox(admin.ctx, admin.email, [
      {
        from: admin.email,
        to: [all],
        text: "FYI: Acme's billing contact is billing@acme.example.",
        at: daysAgo(5),
        sent: true,
      },
    ]);
    await backfillConnection(admin.ctx, adminBox.id);
    const billingFact = (statement: string, evidence: string, value: string) => ({
      objects: [acme],
      facts: [{ about: "acme", statement, evidence, predicate: "billing_contact", value }],
    });
    scriptLearning(
      billingFact(
        billing,
        "Acme's billing contact is billing@acme.example",
        "billing@acme.example",
      ),
    );
    await learnStoredItems(orgA.id);
    // Then someone writes to support@ from acme.example that it has changed.
    const support = `support@${orgA.workspaceDomain}`;
    const inbox = await mailboxLearning(
      orgA,
      admin.ctx,
      support,
      "Acme's billing contact is now pay@other.example (acme.example).",
      billingFact(
        changed,
        "Acme's billing contact is now pay@other.example (acme.example)",
        "pay@other.example",
      ),
      "org",
    );
    const { workflowId } = await publishTo(
      admin.ctx,
      "Support replies",
      lookupSpec("org", { about: "sender_company" }),
      [],
    );

    const { runId } = await startRun(admin.ctx, workflowId, inbox.id, inbox.sourceRef);
    fakeAiGateway.text(REPLY);
    expect(await executeRun(systemCtx(orgA.id), runId)).toEqual({ status: "succeeded" });

    expect(draftPrompt()).toContain(`About Acme: ${billing}`);
    expect(draftPrompt()).toContain(`About Acme (disputed`);
    expect(draftPrompt()).toContain(changed);
  });
});

describe("memory.lookup in Try it", () => {
  it("looks up the sender's company or a topic in the view the run would have", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    await withCredits(orgA.id);
    const own = await mailboxLearning(
      orgA,
      admin.ctx,
      admin.email,
      "Visit our offices in Leeds and York.",
      learnings.offices,
    );
    const options = { connectionId: own.id, sourceRef: own.sourceRef };

    fakeAiGateway.text(REPLY);
    const company = await dryRun(
      admin.ctx,
      lookupSpec("member", { about: "sender_company" }),
      options,
    );
    expect(company.steps[0]).toMatchObject({
      stepId: "known",
      status: "succeeded",
      output: { factCount: 1, facts: [{ about: "Acme", statement: OFFICES }] },
    });
    expect(draftPrompt()).toContain(OFFICES);

    fakeAiGateway.text(REPLY);
    const topic = await dryRun(
      admin.ctx,
      lookupSpec("member", { about: "topic", topic: "Leeds offices" }),
      options,
    );
    expect(topic.steps[0]?.output).toMatchObject({ factCount: 1 });
    const [read] = await listAccessLog(admin.ctx);
    expect(read).toMatchObject({ reader: { kind: "builder", userId: admin.id } });
  });

  it("refuses a topic lookup with no topic", async () => {
    const { orgA } = await seedTwoOrgs();
    await withCredits(orgA.id);
    const own = await mailboxLearning(
      orgA,
      orgA.admin.ctx,
      orgA.admin.email,
      "Visit our offices in Leeds and York.",
      learnings.offices,
    );

    const result = await dryRun(orgA.admin.ctx, lookupSpec("member", { about: "topic" }), {
      connectionId: own.id,
      sourceRef: own.sourceRef,
    });

    expect(result.steps[0]).toMatchObject({
      status: "failed",
      error: { code: "invalid_input", message: "The input to memory.lookup is invalid at: topic." },
    });
  });
});
