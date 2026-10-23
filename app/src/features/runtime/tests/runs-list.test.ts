// The Runs page's list: every run across workflows, newest first. An admin
// sees every run in the company, a colleague's redacted to what happened without what it read;
// a member sees the runs on their own inbox, in full (ADR-0001).
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { env } from "@/env";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, failCrashedRun, listRuns, startRun } from "../server";
import { company, readStep } from "./company-runs";
import { pricingQuestion, publish } from "./run-helpers";

beforeEach(resetDatabase);

describe("listRuns", () => {
  it("shows an admin a colleague's run redacted, and their own and the org's in full", async () => {
    const { orgA, admin, own, orgMessage, sales, run } = await company();
    const ownRun = await run("own", "succeeded");
    const colleagueRun = await run("colleague", "failed");
    const orgRun = await run("org", "succeeded");

    const page = await listRuns(admin, {});

    expect(page).toMatchObject({ newer: null, older: null });
    expect(page.runs).toEqual([
      expect.objectContaining({
        id: orgRun,
        workflowName: "sales",
        inbox: { kind: "org", accountEmail: sales },
        message: {
          sourceRef: orgMessage.id,
          subject: "Shared question",
          from: expect.stringContaining("ada@customer.test") as string,
        },
        status: "succeeded",
        failures: [],
      }),
      expect.objectContaining({
        id: colleagueRun,
        workflowName: "replies",
        inbox: { kind: "colleague", ownerName: orgA.member.email },
        message: null,
        status: "failed",
        // What failed and why stays visible: codes and words only.
        failures: [
          {
            stepId: "read",
            path: null,
            status: "failed",
            errorCode: "source_item_missing",
            errorMessage: expect.any(String) as string,
          },
        ],
      }),
      expect.objectContaining({
        id: ownRun,
        inbox: { kind: "yours", accountEmail: orgA.admin.email },
        message: expect.objectContaining({
          sourceRef: own.messages[0].id,
          subject: "Own question",
        }) as unknown,
      }),
    ]);
  });

  it("shows a member only the runs on their own inbox, in full", async () => {
    const { orgA, member, colleague, run } = await company();
    await run("own", "succeeded");
    const colleagueRun = await run("colleague", "succeeded");
    await run("org", "succeeded");

    const page = await listRuns(member, {});

    expect(page.runs).toEqual([
      expect.objectContaining({
        id: colleagueRun,
        inbox: { kind: "yours", accountEmail: orgA.member.email },
        message: expect.objectContaining({
          sourceRef: colleague.messages[0].id,
          subject: "MARKER-colleague-subject",
        }) as unknown,
      }),
    ]);
    // Filtering to someone else's inbox finds nothing.
    const others = await listRuns(member, { workflowId: undefined, connectionId: "elsewhere" });
    expect(others.runs).toEqual([]);
  });

  it("marks a message Gmail no longer has, rather than failing the list", async () => {
    const { admin, run } = await company();
    const runId = await run("own", "failed");

    const [listed] = (await listRuns(admin, {})).runs;

    expect(listed).toMatchObject({
      id: runId,
      message: { sourceRef: "missing-own", subject: null, from: null },
    });
  });

  it("shows a crashed run's own error, a colleague's too", async () => {
    const { admin, run } = await company();
    const runId = await run("colleague", "running");
    await failCrashedRun(systemCtx(admin.orgId), runId);

    const [listed] = (await listRuns(admin, {})).runs;

    expect(listed).toMatchObject({
      id: runId,
      status: "failed",
      errorCode: "internal_error",
      message: null,
      failures: [],
    });
  });
});

describe("what an admin is given of a colleague's run", () => {
  const DRAFT = "MARKER-generated-draft-text";
  const replySpec = {
    specVersion: 1,
    id: "pricing-replies",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      { ...readStep },
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Reply with our current prices.",
        context: ["trigger.message"],
        output: "google-mail.create-draft",
      },
    ],
    autonomy: { rung: 3 },
  };

  it("holds nothing the run read, made or handed between its steps", async () => {
    const { admin, member, colleague } = await company();
    const promoted: Ctx = { ...member, role: "admin" };
    const message = colleague.mailbox.add(
      pricingQuestion({ subject: "MARKER-subject-7c1e", text: "MARKER-body-2f9a" }),
    );
    const workflowId = await publish(admin, replySpec);
    const { runId } = await startRun(promoted, workflowId, colleague.connectionId, message.id);
    fakeAiGateway.text(DRAFT, { costUsd: 0.002 });
    expect(await executeRun(systemCtx(admin.orgId), runId)).toEqual({ status: "succeeded" });
    const [draft] = colleague.mailbox.drafts();
    const markers = [
      "MARKER-subject-7c1e",
      "MARKER-body-2f9a",
      DRAFT,
      message.id,
      message.threadId,
      draft.id,
    ];

    const given = JSON.stringify(await listRuns(admin, { workflowId }));

    for (const marker of markers) expect(given).not.toContain(marker);
    expect(JSON.parse(given)).toMatchObject({
      runs: [
        { id: runId, status: "succeeded", message: null, costCredits: 0.002 * env.CREDITS_PER_USD },
      ],
    });
    // Its owner sees the message it ran on.
    const owners = JSON.stringify(await listRuns(member, { workflowId }));
    expect(owners).toContain("MARKER-subject-7c1e");
    expect(owners).toContain(message.id);
  });
});
