// The signed unsubscribe link in the digest email: following it turns the digest off for the
// person it was made for, and for no one else; a link that wasn't signed by Mycel does nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { removeUser } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { reviewDigestOn, unsubscribeLink, unsubscribeWithLink } from "../server";

beforeEach(resetDatabase);

function tokenOf(link: string): string {
  return new URL(link).searchParams.get("token") ?? "";
}

describe("the unsubscribe link", () => {
  it("is a link to Mycel's unsubscribe page", async () => {
    const { orgA } = await seedTwoOrgs();

    const link = unsubscribeLink(systemCtx(orgA.id), orgA.member.id);

    expect(link).toMatch(/^http:\/\/localhost:3000\/unsubscribe\?token=[\w.-]+$/);
  });

  it("turns the digest off for that person only", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const link = unsubscribeLink(systemCtx(orgA.id), orgA.member.id);

    await unsubscribeWithLink(tokenOf(link));

    expect(await reviewDigestOn(orgA.member.ctx)).toBe(false);
    for (const ctx of [orgA.admin.ctx, orgB.admin.ctx, orgB.member.ctx]) {
      expect(await reviewDigestOn(ctx)).toBe(true);
    }
  });

  it("does nothing when its token was changed or made up", async () => {
    const { orgA } = await seedTwoOrgs();
    const token = tokenOf(unsubscribeLink(systemCtx(orgA.id), orgA.member.id));
    const [payload = "", signature = ""] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ orgId: orgA.id, userId: orgA.admin.id })).toString(
      "base64url",
    );

    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.${signature.slice(0, -2)}`,
      payload,
      "",
      "not-a-token",
    ]) {
      await expect(unsubscribeWithLink(bad)).rejects.toThrow(ValidationError);
    }
    expect(await reviewDigestOn(orgA.admin.ctx)).toBe(true);
    expect(await reviewDigestOn(orgA.member.ctx)).toBe(true);
  });

  it("does nothing for someone no longer in the org", async () => {
    const { orgA } = await seedTwoOrgs();
    const link = unsubscribeLink(systemCtx(orgA.id), orgA.member.id);
    await removeUser(orgA.admin.ctx, orgA.member.id);

    await expect(unsubscribeWithLink(tokenOf(link))).rejects.toThrow(ValidationError);
  });

  it("is made only by the digest job, as the system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect(() => unsubscribeLink(ctx, orgA.member.id)).toThrow(ForbiddenError);
    }
  });
});
