import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { removeUser } from "@/features/orgs/server";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import {
  grantStaffConsent,
  listAccessLog,
  listStaffConsents,
  revokeStaffConsent,
  staffReadObject,
  staffSearchMemory,
} from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const DANA = "dana@acme.example";
const STAFF = "sam@mycel.example";
const CASE = "Ticket 4411: a wrong fact about Dana";
const byEmail = { key: { kind: "email" as const, value: DANA } };

// Dana at Acme writes to org A's member, copying its admin; a second admin is on nothing.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const otherAdmin = await seedUser(orgA.id, `kim@${orgA.workspaceDomain}`, "admin");
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    {
      from: `Dana Ruiz <${DANA}>`,
      to: [orgA.member.email],
      cc: [orgA.admin.email],
      text: "I lead procurement at Acme.",
      at: daysAgo(2),
    },
  ]);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [
      {
        about: "dana",
        statement: "Dana Ruiz leads procurement at Acme.",
        evidence: "I lead procurement at Acme",
      },
    ],
  });
  await learnStoredItems(orgA.id);
  return { ...orgs, otherAdmin, staff: systemCtx(orgA.id) };
}

describe("staff reads of memory", () => {
  it("are refused without a consent record", async () => {
    const { orgA, staff } = await setup();
    const access = { consentId: "no-such-consent", staffEmail: STAFF };

    await expect(staffReadObject(staff, access, byEmail)).rejects.toThrow(ForbiddenError);
    await expect(staffSearchMemory(staff, access, { text: "procurement" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await listAccessLog(orgA.admin.ctx)).toEqual([]);
  });

  it("read in the granting admin's view, logged where the customer sees it", async () => {
    const { orgA, staff } = await setup();
    const consent = await grantStaffConsent(orgA.admin.ctx, {
      staffEmail: STAFF,
      reason: CASE,
      days: 7,
    });
    const access = { consentId: consent.id, staffEmail: STAFF };

    const dana = await staffReadObject(staff, access, byEmail);
    const found = await staffSearchMemory(staff, access, { text: "procurement" });

    expect(dana.name).toBe("Dana Ruiz");
    expect(found.facts).toHaveLength(1);
    const staffRead = {
      reader: {
        kind: "staff",
        userId: orgA.admin.id,
        staff: { email: STAFF, reason: CASE },
      },
    };
    expect(await listAccessLog(orgA.admin.ctx)).toMatchObject([staffRead, staffRead]);
    // The member's mailbox holds the fact read, so they see the staff reads too.
    expect(await listAccessLog(orgA.member.ctx)).toMatchObject([staffRead, staffRead]);
  });

  it("show staff only what the granting admin can see", async () => {
    const { orgA, otherAdmin, staff } = await setup();
    const consent = await grantStaffConsent(otherAdmin.ctx, {
      staffEmail: STAFF,
      reason: CASE,
      days: 7,
    });
    const access = { consentId: consent.id, staffEmail: STAFF };

    await expect(staffReadObject(staff, access, byEmail)).rejects.toThrow(NotFoundError);
    expect((await staffSearchMemory(staff, access, { text: "procurement" })).facts).toEqual([]);
    expect(await listAccessLog(orgA.admin.ctx)).toMatchObject([
      { reader: { kind: "staff", userId: otherAdmin.id }, factCount: 0 },
    ]);
  });

  it("are refused for someone else at Mycel, once revoked, once expired, or once its admin leaves", async () => {
    const { orgA, otherAdmin, staff } = await setup();
    const grant = (ctx = orgA.admin.ctx) =>
      grantStaffConsent(ctx, { staffEmail: STAFF, reason: CASE, days: 7 });
    const refused = (consentId: string, staffEmail = STAFF) =>
      expect(staffReadObject(staff, { consentId, staffEmail }, byEmail)).rejects.toThrow(
        ForbiddenError,
      );

    await refused((await grant()).id, "alex@mycel.example");

    const revoked = await grant();
    await revokeStaffConsent(orgA.admin.ctx, revoked.id);
    await refused(revoked.id);

    const leaving = await grant(otherAdmin.ctx);
    await removeUser(orgA.admin.ctx, otherAdmin.id);
    await refused(leaving.id);

    const expiring = await grant();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    await refused(expiring.id);
  });

  it("can't be made by a person in the org, only through our staff's tooling", async () => {
    const { orgA } = await setup();
    const consent = await grantStaffConsent(orgA.admin.ctx, {
      staffEmail: STAFF,
      reason: CASE,
      days: 7,
    });
    const access = { consentId: consent.id, staffEmail: STAFF };

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(staffReadObject(ctx, access, byEmail)).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("staff consents", () => {
  it("are granted, listed and revoked by admins only", async () => {
    const { orgA } = await setup();
    const input = { staffEmail: " Sam@Mycel.example ", reason: CASE, days: 3 };

    await expect(grantStaffConsent(orgA.member.ctx, input)).rejects.toThrow(ForbiddenError);
    const consent = await grantStaffConsent(orgA.admin.ctx, input);
    expect(consent).toMatchObject({
      staffEmail: STAFF,
      reason: CASE,
      grantedBy: { userId: orgA.admin.id, name: orgA.admin.email },
      revokedAt: null,
    });
    const days = (consent.expiresAt.getTime() - consent.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(3);

    await expect(listStaffConsents(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
    await expect(revokeStaffConsent(orgA.member.ctx, consent.id)).rejects.toThrow(ForbiddenError);
    await revokeStaffConsent(orgA.admin.ctx, consent.id);
    expect(await listStaffConsents(orgA.admin.ctx)).toMatchObject([
      { id: consent.id, revokedAt: expect.any(Date) as Date },
    ]);
  });

  it("are for one case, at most 30 days, to a real address", async () => {
    const { orgA } = await setup();
    const grant = (input: { staffEmail: string; reason: string; days: number }) =>
      grantStaffConsent(orgA.admin.ctx, input);

    await expect(grant({ staffEmail: STAFF, reason: CASE, days: 31 })).rejects.toThrow();
    await expect(grant({ staffEmail: STAFF, reason: " ", days: 7 })).rejects.toThrow();
    await expect(grant({ staffEmail: "sam", reason: CASE, days: 7 })).rejects.toThrow();
    expect(await listStaffConsents(orgA.admin.ctx)).toEqual([]);
  });
});
