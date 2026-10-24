// Ask Mycel conversations don't pile up (spec #154): each night, as the org's system ctx, the
// conversations nobody has used for 90 days are deleted, with their messages.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { DAY_MS } from "@/lib/time";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import {
  deleteIdleConversations,
  getConversation,
  listConversations,
  startConversation,
  streamTurn,
} from "../server";

beforeEach(resetDatabase);

const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

/** A conversation with one turn, used now. */
async function used(ctx: Ctx): Promise<string> {
  const { id } = await startConversation(ctx);
  fakeAiGateway.reply({ text: "Hello." });
  await readTurn(await streamTurn(ctx, id, "Hello"));
  return id;
}

describe("idle conversations", () => {
  it("are deleted once 90 days unused, with their messages; one used yesterday stays", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const id = await used(member);
    const job = (now: Date) => deleteIdleConversations(systemCtx(orgA.id), now);

    expect(await job(inDays(1))).toEqual({ conversations: 0 });
    expect(await job(inDays(89))).toEqual({ conversations: 0 });
    expect((await getConversation(member, id)).messages).toHaveLength(2);

    expect(await job(inDays(91))).toEqual({ conversations: 1 });
    expect(await listConversations(member)).toEqual([]);
    await expect(getConversation(member, id)).rejects.toThrow(NotFoundError);
  });

  it("are deleted per org, by that org's job", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    await fundOrg(orgB.id);
    await used(orgA.member.ctx);
    const kept = await used(orgB.member.ctx);

    expect(await deleteIdleConversations(systemCtx(orgA.id), inDays(91))).toEqual({
      conversations: 1,
    });

    expect((await listConversations(orgB.member.ctx)).map((c) => c.id)).toEqual([kept]);
  });

  it("are deleted only by the org's system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(deleteIdleConversations(ctx)).rejects.toThrow(ForbiddenError);
    }
  });
});
