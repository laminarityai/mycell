// Ask Mycel's conversations are their person's own (spec #154): every read and write needs the
// ctx's user to be the owner, with no admin or system exception, and they go when the member
// does.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { removeUser } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import {
  deleteConversation,
  getConversation,
  listConversations,
  startConversation,
  streamTurn,
} from "../server";

beforeEach(resetDatabase);

describe("a person's conversations", () => {
  it("are listed to their owner only, most recently active first, titled by their first message", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { member, admin } = orgA;
    const first = await startConversation(member.ctx);
    fakeAiGateway.reply({ text: "Hello." });
    await readTurn(await streamTurn(member.ctx, first.id, "What did we agree with Acme?"));
    const second = await startConversation(member.ctx);
    fakeAiGateway.reply({ text: "Hello again." });
    await readTurn(await streamTurn(member.ctx, second.id, "Who buys for Brightline?"));

    expect(await listConversations(member.ctx)).toEqual([
      expect.objectContaining({ id: second.id, title: "Who buys for Brightline?" }),
      expect.objectContaining({ id: first.id, title: "What did we agree with Acme?" }),
    ]);
    // Not even an admin sees them.
    expect(await listConversations(admin.ctx)).toEqual([]);
  });

  it("starts a new one only when the newest isn't still empty", async () => {
    const { orgA } = await seedTwoOrgs();

    const first = await startConversation(orgA.member.ctx);
    const again = await startConversation(orgA.member.ctx);

    expect(again.id).toBe(first.id);
    expect(await listConversations(orgA.member.ctx)).toHaveLength(1);
    // A colleague's empty conversation is theirs.
    expect((await startConversation(orgA.admin.ctx)).id).not.toBe(first.id);
  });

  it("can't be read, continued or deleted by anyone else, admins included", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const { member, admin } = orgA;
    const own = await startConversation(member.ctx);
    fakeAiGateway.reply({ text: "Acme renews in March." });
    await readTurn(await streamTurn(member.ctx, own.id, "When does Acme renew?"));
    const before = await getConversation(member.ctx, own.id);
    const calls = fakeAiGateway.requests().length;
    const colleague = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");

    for (const ctx of [colleague.ctx, admin.ctx]) {
      await expect(getConversation(ctx, own.id)).rejects.toThrow(NotFoundError);
      await expect(streamTurn(ctx, own.id, "And then?")).rejects.toThrow(NotFoundError);
      await expect(deleteConversation(ctx, own.id)).rejects.toThrow(NotFoundError);
    }
    const system = systemCtx(orgA.id);
    await expect(listConversations(system)).rejects.toThrow(ForbiddenError);
    await expect(startConversation(system)).rejects.toThrow(ForbiddenError);
    await expect(getConversation(system, own.id)).rejects.toThrow(ForbiddenError);
    await expect(streamTurn(system, own.id, "And then?")).rejects.toThrow(ForbiddenError);
    await expect(deleteConversation(system, own.id)).rejects.toThrow(ForbiddenError);

    expect(fakeAiGateway.requests()).toHaveLength(calls);
    expect(await getConversation(member.ctx, own.id)).toEqual(before);
  });

  it("is deleted by its owner, with its messages", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const own = await startConversation(orgA.member.ctx);
    fakeAiGateway.reply({ text: "Hello." });
    await readTurn(await streamTurn(orgA.member.ctx, own.id, "Hi"));

    await deleteConversation(orgA.member.ctx, own.id);

    expect(await listConversations(orgA.member.ctx)).toEqual([]);
    await expect(getConversation(orgA.member.ctx, own.id)).rejects.toThrow(NotFoundError);
  });

  it("go when their member is removed", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const own = await startConversation(orgA.member.ctx);
    fakeAiGateway.reply({ text: "Hello." });
    await readTurn(await streamTurn(orgA.member.ctx, own.id, "Hi"));
    const kept = await startConversation(orgA.admin.ctx);

    await removeUser(orgA.admin.ctx, orgA.member.id);

    expect(await listConversations(orgA.member.ctx)).toEqual([]);
    expect(await listConversations(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ id: kept.id }),
    ]);
  });
});
