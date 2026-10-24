import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startReconnect } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { SpecInvalidError } from "@/lib/errors";
import { connectGoogle, connectOldConnection, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { saveWorkflow } from "../server";
import { draftSpec, labelSpec, sheetSpec, taskSpec } from "./specs";

beforeEach(resetDatabase);

async function issuesOf(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof SpecInvalidError)) throw new Error("expected a SpecInvalidError");
  return error.issues;
}

/** The admin's Gmail connected read-only, as one-app connections were (gmail.readonly). */
async function readOnlyAdmin(kind: "member" | "org" = "member") {
  const { orgA } = await seedTwoOrgs();
  const email = kind === "member" ? orgA.admin.email : "support@org-a.test";
  const connection = await connectOldConnection(orgA.admin.ctx, "gmail", email, { kind });
  return { admin: orgA.admin.ctx, email, connection };
}

describe("saveWorkflow's scope check", () => {
  it("refuses a draft spec on a read-only connection, naming the action and the scope", async () => {
    const { admin, email } = await readOnlyAdmin();

    expect(await issuesOf(saveWorkflow(admin, { name: "Replies", spec: draftSpec() }))).toEqual([
      {
        path: ["steps", 2, "output"],
        message: `google-mail.create-draft needs the gmail.modify scope, which ${email} wasn't granted. Reconnect it to grant write access.`,
      },
    ]);
  });

  it("saves the draft spec once the connection is reconnected with gmail.modify", async () => {
    const { admin, connection } = await readOnlyAdmin();
    const { token } = await startReconnect(admin, connection.id);
    await deliver(fakeNango.completeReconnect(token, undefined, [GOOGLE_APP_SCOPES.gmail]));

    const saved = await saveWorkflow(admin, { name: "Replies", spec: draftSpec() });

    expect(saved.maxRisk).toBe("external_send");
  });

  it("refuses a label step on a read-only connection", async () => {
    const { admin, email } = await readOnlyAdmin();

    expect(await issuesOf(saveWorkflow(admin, { name: "Label", spec: labelSpec() }))).toEqual([
      {
        path: ["steps", 1, "action"],
        message: `google-mail.add-label needs the gmail.modify scope, which ${email} wasn't granted. Reconnect it to grant write access.`,
      },
    ]);
  });

  it("saves a spec that only reads on a read-only connection", async () => {
    const { admin } = await readOnlyAdmin();
    const spec = labelSpec({
      steps: [
        {
          id: "read",
          type: "tool",
          action: "google-mail.read-message",
          input: { messageId: { from: "trigger.messageId" } },
        },
      ],
    });

    expect((await saveWorkflow(admin, { name: "Read", spec })).maxRisk).toBe("read");
  });

  it("checks an org spec against the org's connection", async () => {
    const { admin, email } = await readOnlyAdmin("org");

    const spec = draftSpec({ credentials: "org" });
    expect(await issuesOf(saveWorkflow(admin, { name: "Replies", spec }))).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(`which ${email} wasn't granted`) as string,
      }),
    ]);
  });
});

describe("saveWorkflow with Sheets actions", () => {
  const readOnly = sheetSpec({ steps: (sheetSpec().steps as unknown[]).slice(0, 1) });

  it("refuses them without a Google connection", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Log", spec: sheetSpec() })),
    ).toEqual([expect.objectContaining({ path: ["credentials"] })]);
  });

  it("refuses append-row on a connection not allowed Sheets, naming the app", async () => {
    const { orgA } = await seedTwoOrgs();
    const scopes = [GOOGLE_APP_SCOPES.gmail, GOOGLE_APP_SCOPES.drive];
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes });

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Log", spec: sheetSpec() })),
    ).toEqual([
      {
        path: ["steps", 1, "action"],
        message: `google-sheet.append-row needs Sheets, which ${orgA.admin.email} wasn't granted. Reconnect it to allow Sheets.`,
      },
    ]);
  });

  it("refuses suggest-edits on a connection not allowed Docs, naming the app", async () => {
    const { orgA } = await seedTwoOrgs();
    const scopes = [GOOGLE_APP_SCOPES.gmail, GOOGLE_APP_SCOPES.drive];
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes });
    const spec = {
      ...sheetSpec(),
      steps: [
        {
          id: "suggest",
          type: "tool",
          action: "google-docs.suggest-edits",
          input: {
            documentId: "doc-1",
            requests: [{ insertText: { text: "Done.", endOfSegmentLocation: {} } }],
          },
        },
      ],
    };

    expect(await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Status", spec }))).toEqual([
      {
        path: ["steps", 0, "action"],
        message: `google-docs.suggest-edits needs Docs, which ${orgA.admin.email} wasn't granted. Reconnect it to allow Docs.`,
      },
    ]);
  });

  it("saves read-range on Drive's read-only scope alone", async () => {
    const { orgA } = await seedTwoOrgs();
    const scopes = [GOOGLE_APP_SCOPES.gmail, GOOGLE_APP_SCOPES.drive];
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes });

    const saved = await saveWorkflow(orgA.admin.ctx, { name: "Prices", spec: readOnly });

    expect(saved.maxRisk).toBe("read");
  });

  it("checks an org spec against the org's connection, not the admin's own", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const scopes = [GOOGLE_APP_SCOPES.gmail];
    await connectGoogle(orgA.admin.ctx, "support@org-a.test", { kind: "org", scopes });

    const spec = sheetSpec({ credentials: "org" });
    expect(await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Log", spec }))).toEqual([
      expect.objectContaining({ path: ["steps", 0, "action"] }),
      expect.objectContaining({ path: ["steps", 1, "action"] }),
    ]);
  });
});

describe("saveWorkflow with Tasks actions", () => {
  const allBut = (app: keyof typeof GOOGLE_APP_SCOPES) =>
    Object.entries(GOOGLE_APP_SCOPES).flatMap(([name, scope]) => (name === app ? [] : [scope]));

  it("refuses them on a connection not allowed Tasks, naming the app", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes: allBut("tasks") });

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Follow-ups", spec: taskSpec() })),
    ).toEqual(
      [0, 1, 2].map((index) => ({
        path: ["steps", index, "action"],
        message: expect.stringMatching(
          new RegExp(
            `needs Tasks, which ${orgA.admin.email} wasn't granted. Reconnect it to allow Tasks.$`,
          ),
        ) as string,
      })),
    );
  });

  it("refuses the writes on Tasks' read-only scope, and saves the list alone there", async () => {
    const { orgA } = await seedTwoOrgs();
    const readOnly = "https://www.googleapis.com/auth/tasks.readonly";
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, {
      scopes: [...allBut("tasks"), readOnly],
    });

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Follow-ups", spec: taskSpec() })),
    ).toEqual([
      expect.objectContaining({ path: ["steps", 1, "action"] }),
      expect.objectContaining({ path: ["steps", 2, "action"] }),
    ]);
    const listOnly = taskSpec({ steps: (taskSpec().steps as unknown[]).slice(0, 1) });
    expect((await saveWorkflow(orgA.admin.ctx, { name: "Open", spec: listOnly })).maxRisk).toBe(
      "read",
    );
  });

  it("saves them, with no review, on a connection allowed Tasks", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);

    const saved = await saveWorkflow(orgA.admin.ctx, { name: "Follow-ups", spec: taskSpec() });

    expect(saved.maxRisk).toBe("internal_reversible");
  });

  it("refuses a due date with a time of day, which Tasks would drop", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const steps = taskSpec().steps as Record<string, unknown>[];
    const withTime = taskSpec({
      steps: [
        steps[0],
        { ...steps[1], input: { title: "Call back", due: "2026-11-02T09:00:00Z" } },
      ],
    });

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Follow-ups", spec: withTime })),
    ).toEqual([
      {
        path: ["steps", 1, "input", "due"],
        message: "due: Give the due date as a date, YYYY-MM-DD: Tasks keeps no time of day.",
      },
    ]);
  });
});
