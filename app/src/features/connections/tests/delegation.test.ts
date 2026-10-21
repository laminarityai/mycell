// Delegated connection access (ADR-0016): a ctx delegated one connection reaches that connection
// through getConnection and the proxy, and nothing else its user couldn't reach before.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import { delegatedCtx } from "../delegation";
import { getConnection, getGrantedScopes, proxyGet, recordIngestState } from "../server";

beforeEach(resetDatabase);

const profile = z.object({ emailAddress: z.string() });
const PROFILE = "/gmail/v1/users/me/profile";

describe("a delegated ctx", () => {
  it("reaches the one connection it was delegated, through getConnection and the proxy", async () => {
    const { orgA } = await seedTwoOrgs();
    const owners = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const delegated = delegatedCtx(orgA.admin.ctx, owners.id);

    expect(await proxyGet(delegated, owners.id, PROFILE, profile)).toEqual({
      emailAddress: orgA.member.email,
    });
    expect(await getConnection(delegated, owners.id)).toMatchObject({ id: owners.id });
  });

  it("reaches nothing else its user can't: not another connection, nor the connection's records", async () => {
    const { orgA } = await seedTwoOrgs();
    const owners = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const others = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const delegated = delegatedCtx(orgA.member.ctx, others.id);

    await expect(proxyGet(delegated, owners.id, PROFILE, profile)).resolves.not.toBeNull();
    await expect(getGrantedScopes(delegated, others.id)).rejects.toThrow(ForbiddenError);
    await expect(
      recordIngestState(delegated, others.id, "gmail", { status: "active" }),
    ).rejects.toThrow(ForbiddenError);
    // A copy of the ctx made by hand was delegated nothing.
    await expect(proxyGet({ ...delegated }, others.id, PROFILE, profile)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(proxyGet(orgA.member.ctx, others.id, PROFILE, profile)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("can't reach another org's connection", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBs = await connectMailbox(orgB.member.ctx, orgB.member.email);

    const delegated = delegatedCtx(orgA.admin.ctx, orgBs.id);

    await expect(proxyGet(delegated, orgBs.id, PROFILE, profile)).rejects.toThrow(NotFoundError);
    await expect(getConnection(delegated, orgBs.id)).rejects.toThrow(NotFoundError);
  });
});
