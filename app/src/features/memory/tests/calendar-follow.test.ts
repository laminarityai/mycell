// Calendar invites over time (#108, ADR-0029): matched with what email taught about the same
// people, learned again when their organizer changes what they say, their access lists re-read
// when their guests change, and forgotten when they're cancelled, when their connection goes,
// or when the nightly re-read finds them gone.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { backfillConnection } from "@/features/discovery/server";
import { pollCalendar } from "@/features/runtime/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGoogle, daysAgo } from "@/testing/connect-helpers";
import { readObject, rereadAllAccess } from "../server";
import {
  followAppChanges,
  learnStoredItems,
  scriptInviteLearning,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const ADA = "ada@acme.example";
const MEETING = "Ada Lovelace meets the team about Acme's renewal.";
const MOVED = "Ada Lovelace meets the team about Acme's pricing.";

const byAda = { key: { kind: "email" as const, value: ADA } };

const meeting = (statement: string, evidence: string): ScriptedExtraction => ({
  objects: [{ ref: "ada", kind: "person", name: "Ada Lovelace", email: ADA }],
  facts: [{ about: "ada", statement, evidence }],
});

// Org A's admin organises a renewal review with the member and Ada, learned from the admin's
// calendar.
async function learnedMeeting() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const admin = await connectGoogle(orgA.admin.ctx, orgA.admin.email, {
    messages: [
      {
        from: `Ada Lovelace <${ADA}>`,
        to: [orgA.admin.email],
        subject: "Hello",
        text: "I run purchasing at Acme.",
        at: daysAgo(3),
      },
    ],
  });
  const system = systemCtx(orgA.id);
  await pollCalendar(system, admin.id);
  const event = admin.calendar.organize({
    title: "Acme renewal review",
    guests: [orgA.member.email, ADA],
  });
  await pollCalendar(system, admin.id);
  scriptInviteLearning(meeting(MEETING, "Acme renewal review"));
  expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
  return { ...orgs, admin, system, event };
}

const statements = async (ctx: Parameters<typeof readObject>[0]) =>
  (await readObject(ctx, byAda)).facts.map((fact) => fact.statement).sort();

describe("matching", () => {
  it("attaches an invite's facts and an email's about the same address to one object", async () => {
    const { orgA, admin } = await learnedMeeting();
    await backfillConnection(orgA.admin.ctx, admin.id);
    scriptLearning(meeting("Ada Lovelace runs purchasing at Acme.", "I run purchasing at Acme"));

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);

    expect(await statements(orgA.admin.ctx)).toEqual([
      "Ada Lovelace meets the team about Acme's renewal.",
      "Ada Lovelace runs purchasing at Acme.",
    ]);
  });
});

describe("following an invite's changes", () => {
  it("learns an invite again when its organizer changes what it says, and drops what it no longer says", async () => {
    const { orgA, admin, system, event } = await learnedMeeting();
    admin.calendar.edit(event.id, { title: "Acme pricing review" });
    await pollCalendar(system, admin.id);
    scriptInviteLearning(meeting(MOVED, "Acme pricing review"));

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);

    const ada = await readObject(orgA.admin.ctx, byAda);
    expect(ada.facts.map((fact) => [fact.statement, fact.sources.map((s) => s.sourceRef)])).toEqual(
      [[MOVED, [`${event.id}@1`]]],
    );
    expect(await tablesHolding(MEETING)).toEqual([]);
  });

  it("re-reads who may see it, with no model call, when a guest answers or the guests change", async () => {
    const { orgA, admin, system, event } = await learnedMeeting();
    admin.calendar.respond(event.id, "accepted");
    await pollCalendar(system, admin.id);
    // Nothing scripted: a version learned already reaches no model.
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "known" }]);
    await followAppChanges(orgA.id);
    expect(await statements(orgA.member.ctx)).toEqual([MEETING]);

    // The member is taken off the guest list.
    admin.calendar.setGuests(event.id, [ADA]);
    await pollCalendar(system, admin.id);
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "known" }]);
    await followAppChanges(orgA.id);

    await expect(readObject(orgA.member.ctx, byAda)).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.admin.ctx)).toEqual([MEETING]);
  });

  it("forgets what a cancelled invite taught", async () => {
    const { orgA, admin, system, event } = await learnedMeeting();
    admin.calendar.cancel(event.id);
    await pollCalendar(system, admin.id);

    await followAppChanges(orgA.id);

    await expect(readObject(orgA.admin.ctx, byAda)).rejects.toThrow(NotFoundError);
    expect(await tablesHolding(MEETING)).toEqual([]);
  });

  it("forgets everything an invite taught when its connection is deleted", async () => {
    const { orgA, admin } = await learnedMeeting();

    await disconnect(orgA.admin.ctx, admin.id);

    await expect(readObject(orgA.member.ctx, byAda)).rejects.toThrow(NotFoundError);
    expect(await tablesHolding(MEETING)).toEqual([]);
    expect(await tablesHolding(ADA)).toEqual([]);
  });
});

describe("the nightly re-read of Calendar access", () => {
  it("catches a cancellation the poll missed when Google expired its sync token", async () => {
    const { orgA, admin, system, event } = await learnedMeeting();
    admin.calendar.cancel(event.id);
    admin.calendar.expireSyncTokens();
    // A full sync: it lists no cancelled event, and tells memory nothing.
    expect(await pollCalendar(system, admin.id)).toEqual({ outcome: "synced" });

    expect(await rereadAllAccess(system)).toEqual({ items: 1, removed: 1 });

    await expect(readObject(orgA.admin.ctx, byAda)).rejects.toThrow(NotFoundError);
  });

  it("catches a guest change the poll missed", async () => {
    const { orgA, admin, system, event } = await learnedMeeting();
    admin.calendar.setGuests(event.id, [ADA]);
    admin.calendar.expireSyncTokens();
    await pollCalendar(system, admin.id);

    expect(await rereadAllAccess(system)).toEqual({ items: 1, removed: 0 });

    await expect(readObject(orgA.member.ctx, byAda)).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.admin.ctx)).toEqual([MEETING]);
  });
});
