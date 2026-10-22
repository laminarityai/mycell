// Our staff read memory only through a consent an admin grants for one case (ADR-0024): named
// to one person at Mycel, for at most MAX_STAFF_CONSENT_DAYS, revocable at any time. A staff
// read runs as the org's system ctx (our own tooling, never a person in the org), in the view
// of the admin who granted the consent, so it shows no more than that admin can see, and is
// logged in the org's access log like any other read.
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers, userNames } from "@/features/orgs/server";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  MAX_STAFF_CONSENT_DAYS,
  staffConsentInputSchema,
  type MemoryObject,
  type MemorySearch,
  type MemorySearchResult,
  type ObjectLookup,
  type StaffAccess,
  type StaffConsent,
  type StaffConsentInput,
} from "../types";
import { readObjectAs, searchAs } from "./logged-reads";
import { staffConsents } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

type ConsentRow = typeof staffConsents.$inferSelect;

/** An admin lets one of our staff read memory, in that admin's view, for one case. */
export async function grantStaffConsent(ctx: Ctx, input: StaffConsentInput): Promise<StaffConsent> {
  requireAdmin(ctx);
  const parsed = staffConsentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Name the person at Mycel by email address, say what the case is, and allow 1 to ${String(MAX_STAFF_CONSENT_DAYS)} days.`,
    );
  }
  const { staffEmail, reason, days } = parsed.data;
  const now = new Date();
  const [row] = await forOrg(ctx).insert(staffConsents, {
    id: randomUUID(),
    grantedByUserId: ctx.userId,
    staffEmail,
    reason,
    createdAt: now,
    expiresAt: new Date(now.getTime() + days * DAY_MS),
  });
  return describe(row, await userNames(ctx));
}

/** Ends a consent at once. Revoking one already revoked changes nothing. */
export async function revokeStaffConsent(ctx: Ctx, consentId: string): Promise<void> {
  requireAdmin(ctx);
  const db = forOrg(ctx);
  const found = await db.select(staffConsents, { where: eq(staffConsents.id, consentId) });
  if (found.length === 0) throw new NotFoundError("consent");
  await db.update(
    staffConsents,
    { revokedAt: new Date() },
    and(eq(staffConsents.id, consentId), isNull(staffConsents.revokedAt)),
  );
}

/** The org's staff consents, newest first, revoked and expired ones included. */
export async function listStaffConsents(ctx: Ctx): Promise<StaffConsent[]> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(staffConsents, {
    orderBy: [desc(staffConsents.createdAt), desc(staffConsents.id)],
  });
  const names = await userNames(ctx);
  return rows.map((row) => describe(row, names));
}

/** One of our staff reads an object under a consent. Refused (ForbiddenError) without one. */
export async function staffReadObject(
  ctx: Ctx,
  access: StaffAccess,
  lookup: ObjectLookup,
): Promise<MemoryObject> {
  const { granter, consentId } = await consented(ctx, access);
  return readObjectAs(granter, lookup, { kind: "staff", staffConsentId: consentId });
}

/** One of our staff searches memory under a consent. Refused (ForbiddenError) without one. */
export async function staffSearchMemory(
  ctx: Ctx,
  access: StaffAccess,
  search: MemorySearch,
): Promise<MemorySearchResult> {
  const { granter, consentId } = await consented(ctx, access);
  return searchAs(granter, search, { kind: "staff", staffConsentId: consentId });
}

/**
 * The ctx of the admin whose consent covers this read: a consent in the org, to this person at
 * Mycel, neither revoked nor expired, from an admin still in the org. Anything else is refused.
 */
async function consented(ctx: Ctx, access: StaffAccess) {
  if (ctx.role !== "system") throw new ForbiddenError();
  const consent = (
    await forOrg(ctx).select(staffConsents, { where: eq(staffConsents.id, access.consentId) })
  ).at(0);
  const now = new Date();
  if (
    consent === undefined ||
    consent.revokedAt !== null ||
    consent.expiresAt <= now ||
    consent.staffEmail !== access.staffEmail.trim().toLowerCase()
  ) {
    throw new ForbiddenError();
  }
  const admin = (await listUsers(ctx)).find((user) => user.id === consent.grantedByUserId);
  if (admin?.role !== "admin") throw new ForbiddenError();
  const granter: Ctx = { orgId: ctx.orgId, userId: admin.id, role: admin.role };
  return { granter, consentId: consent.id };
}

function describe(row: ConsentRow, names: (userId: string) => string): StaffConsent {
  return {
    id: row.id,
    staffEmail: row.staffEmail,
    reason: row.reason,
    grantedBy: { userId: row.grantedByUserId, name: names(row.grantedByUserId) },
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}
