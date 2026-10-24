import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { executeRun, getRun, startRun } from "../server";
import { connectInbox, pricingQuestion, publish, recordedBackoff, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

const labelStep = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};

async function labelRun() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
  const message = inbox.messages[0];
  const workflowId = await publish(admin, threadSpec({ steps: [labelStep] }));
  const start = () => startRun(admin, workflowId, inbox.connectionId, message.id);
  const { runId } = await start();
  return { admin, system, mailbox: inbox.mailbox, message, runId, start };
}

describe("the add-label action", () => {
  it("creates the label when the mailbox lacks it, and puts it on the message", async () => {
    const { admin, system, mailbox, message, runId } = await labelRun();

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    const [label] = mailbox.writes.madeLabels();
    expect(label).toMatchObject({ name: "Pricing" });
    expect(mailbox.labelNamesOf(message.id)).toContain("Pricing");
    expect((await getRun(admin, runId)).steps).toMatchObject([
      {
        stepId: "label",
        status: "succeeded",
        output: {
          fields: {
            messageId: { kind: "text", size: message.id.length },
            labelId: { kind: "text", size: label.id.length },
          },
        },
      },
    ]);
  });

  it("uses the label the mailbox already has, matching its name in any case", async () => {
    const { system, mailbox, message, runId } = await labelRun();
    mailbox.writes.createLabel("pricing");

    await executeRun(system, runId);

    expect(mailbox.writes.madeLabels()).toHaveLength(1);
    expect(mailbox.labelNamesOf(message.id)).toContain("pricing");
  });

  it("labels the message once when its first try's answer was lost and it's tried again", async () => {
    const { admin, system, mailbox, message, runId } = await labelRun();
    // Gmail labels the message, but the answer never arrives.
    mailbox.writes.loseNextAnswer();
    mailbox.writes.loseNextAnswer();

    expect(await executeRun(system, runId, undefined, recordedBackoff().sleep)).toEqual({
      status: "succeeded",
    });

    expect(mailbox.writes.log).toEqual(["labels.create", "messages.modify"]);
    expect(mailbox.labelNamesOf(message.id).filter((name) => name === "Pricing")).toHaveLength(1);
    expect((await getRun(admin, runId)).steps).toMatchObject([{ stepId: "label", attempts: 3 }]);
  });
});
