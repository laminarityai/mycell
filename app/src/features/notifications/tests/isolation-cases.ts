import { expect } from "vitest";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import * as server from "../server";

// Org B's member turned the digest off; every case checks it stays exactly so for org B.
async function orgBDigestOff({ orgB }: TwoOrgs) {
  await server.setReviewDigest(orgB.member.ctx, false);
}

async function orgBUnchanged({ orgB }: TwoOrgs) {
  expect(await server.reviewDigestOn(orgB.member.ctx)).toBe(false);
  expect(await server.reviewDigestOn(orgB.admin.ctx)).toBe(true);
}

export const isolationCases = defineIsolationCases(server, {
  sendEmail: notTenantScoped("sends the email its caller wrote; reads and writes no org data"),

  reviewDigestOn: async (orgs) => {
    await orgBDigestOff(orgs);

    expect(await server.reviewDigestOn(orgs.orgA.member.ctx)).toBe(true);
    await orgBUnchanged(orgs);
  },

  setReviewDigest: async (orgs) => {
    await orgBDigestOff(orgs);

    await server.setReviewDigest(orgs.orgA.admin.ctx, false);
    await server.setReviewDigest(orgs.orgA.member.ctx, true);

    await orgBUnchanged(orgs);
  },

  digestTurnedOff: async (orgs) => {
    await orgBDigestOff(orgs);
    const orgBUsers = [orgs.orgB.member.id, orgs.orgB.admin.id];

    expect(await server.digestTurnedOff(systemCtx(orgs.orgA.id), orgBUsers)).toEqual(new Set());
    await orgBUnchanged(orgs);
  },

  // A link org A's digest makes names org A: for org B's member it turns nothing off.
  unsubscribeLink: async (orgs) => {
    const link = server.unsubscribeLink(systemCtx(orgs.orgA.id), orgs.orgB.admin.id);
    const token = new URL(link).searchParams.get("token") ?? "";

    await expect(server.unsubscribeWithLink(token)).rejects.toThrow(ValidationError);
    expect(await server.reviewDigestOn(orgs.orgB.admin.ctx)).toBe(true);
  },

  unsubscribeWithLink: async (orgs) => {
    await orgBDigestOff(orgs);
    const link = server.unsubscribeLink(systemCtx(orgs.orgA.id), orgs.orgA.member.id);

    await server.unsubscribeWithLink(new URL(link).searchParams.get("token") ?? "");

    expect(await server.reviewDigestOn(orgs.orgA.member.ctx)).toBe(false);
    await orgBUnchanged(orgs);
  },
});
