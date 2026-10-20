import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startReconnect } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { SpecInvalidError } from "@/lib/errors";
import { connectOldConnection, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { saveWorkflow } from "../server";
import { draftSpec, labelSpec } from "./specs";

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
