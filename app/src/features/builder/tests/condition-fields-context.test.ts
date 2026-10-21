import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { startConversation, streamTurn } from "../server";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

describe("a turn's context", () => {
  it("lists the fields a condition may test: the trigger's facts and the catalog's", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { id } = await startConversation(orgA.admin.ctx, {});
    fakeAiGateway.reply({ text: "Hello." });

    await readTurn(await streamTurn(orgA.admin.ctx, id, "What can a branch test?"));

    const request = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    for (const fact of [
      "trigger.sender (text)",
      "trigger.senderDomain (text)",
      "trigger.subject (text)",
      "trigger.hasAttachment (yesNo)",
      "trigger.isReply (yesNo)",
    ]) {
      expect(request).toContain(fact);
    }
    expect(request).toContain("google-mail.read-thread: <step>.messageCount (number)");
    expect(request).toContain("google-sheet.read-range: <step>.rowCount (number)");
    expect(request).toContain("yesNo: is_yes, is_no");
  });
});
