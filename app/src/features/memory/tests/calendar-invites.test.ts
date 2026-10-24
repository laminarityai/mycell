// Learning from Calendar invites (#108, ADR-0029): the Calendar poll tells memory what changed
// on each calendar once memory has started, and memory extracts and matches an invite like an
// email. An invite's facts reach its organizer and guests only, and none of its text is stored.
import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { listLedger } from "@/features/credits/server";
import { calendarsDue, pollCalendar } from "@/features/runtime/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { addExclusion, readObject, startMemory } from "../server";
import {
  classifiedAs,
  grantOnly,
  learnStoredItems,
  scriptInviteLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const ADA = "ada@acme.example";
const TITLE = "Acme renewal review";
const MARKER = "QUOKKA-AGENDA-5512";
const MEETING = "Ada Lovelace of Acme meets the team about Acme's renewal.";

const byAda = { key: { kind: "email" as const, value: ADA } };

const ADA_MEETING: ScriptedExtraction = {
  objects: [
    { ref: "ada", kind: "person", name: "Ada Lovelace", email: ADA },
    { ref: "acme", kind: "company", name: "Acme", domain: "acme.example" },
  ],
  facts: [{ about: "ada", statement: MEETING, evidence: `Title: ${TITLE}`, object: "acme" }],
};

// Org A's admin and member connect Google with memory started, and each calendar has had its
// first poll: a full sync, which teaches nothing. Lee is a colleague on no invite.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const admin = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
  const member = await connectGoogle(orgA.member.ctx, orgA.member.email);
  const system = systemCtx(orgA.id);
  for (const connection of [admin, member]) {
    expect(await pollCalendar(system, connection.id)).toEqual({ outcome: "synced" });
  }
  const description = `Agenda: pricing for next year (ref ${MARKER}).`;
  return { ...orgs, lee, admin, member, system, description };
}

describe("learning from a Calendar invite", () => {
  it("learns a business invite's facts once the poll finds it", async () => {
    const { orgA, admin, system, description } = await setup();
    const event = admin.calendar.organize({
      title: TITLE,
      guests: [orgA.member.email, ADA],
      description,
    });
    await pollCalendar(system, admin.id);
    scriptInviteLearning(ADA_MEETING);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 2, facts: 1 }]);

    const ada = await readObject(orgA.admin.ctx, byAda);
    expect(ada).toMatchObject({
      kind: "person",
      name: "Ada Lovelace",
      keys: [{ kind: "email", value: ADA }],
      facts: [
        {
          statement: MEETING,
          linkedObject: { kind: "company", name: "Acme" },
          sources: [{ app: "calendar", connectionId: admin.id, sourceRef: `${event.id}@0` }],
        },
      ],
    });
  });

  it("stores no description text, in any table or event", async () => {
    const { orgA, admin, system, description } = await setup();
    admin.calendar.organize({ title: TITLE, guests: [ADA], description });
    await pollCalendar(system, admin.id);
    scriptInviteLearning(ADA_MEETING);

    await learnStoredItems(orgA.id);

    expect((await readObject(orgA.admin.ctx, byAda)).facts).toHaveLength(1);
    expect(await tablesHolding(MARKER)).toEqual([]);
    expect(await tablesHolding("Agenda: pricing")).toEqual([]);
    const sent = JSON.stringify(fakeInngest.sent());
    expect(sent).not.toContain(MARKER);
    expect(sent).not.toContain(TITLE);
  });

  it("creates nothing from a personal invite, and reads no model for an event with no guests", async () => {
    const { orgA, admin, system } = await setup();
    admin.calendar.invite({ title: "Dentist", organizer: "desk@dentist.example" });
    admin.calendar.organize({ title: "Focus: write the plan", guests: [] });
    await pollCalendar(system, admin.id);
    // Only the invite reaches a model.
    classifiedAs("personal", "invite");

    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
      { outcome: "skipped", reason: "unsupported" },
    ]);
    await expect(
      readObject(orgA.admin.ctx, { key: { kind: "email", value: "desk@dentist.example" } }),
    ).rejects.toThrow(NotFoundError);
  });

  it("records every model call in the ledger", async () => {
    const { orgA, admin, system, description } = await setup();
    admin.calendar.organize({ title: TITLE, guests: [ADA], description });
    await pollCalendar(system, admin.id);
    scriptInviteLearning(ADA_MEETING);

    await learnStoredItems(orgA.id);

    const usage = (await listLedger(systemCtx(orgA.id))).filter((e) => e.kind === "usage");
    expect(usage.map((entry) => [entry.role ?? entry.modelId, entry.outcome]).sort()).toEqual([
      ["classify", "succeeded"],
      ["embed", "succeeded"],
      ["fast", "succeeded"],
      // The injection screen, twice: an invite can change between the two steps.
      ["google/model-armor", "succeeded"],
      ["google/model-armor", "succeeded"],
    ]);
  });

  it("skips an invite an exclusion covers, before any model reads it", async () => {
    const { orgA, admin, system } = await setup();
    await addExclusion(orgA.admin.ctx, { kind: "domain", value: "acme.example" });
    admin.calendar.invite({ title: TITLE, organizer: ADA });
    await pollCalendar(system, admin.id);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "excluded" }]);
  });
});

describe("who sees an invite's facts", () => {
  it("shows an invite a colleague organised to its organizer and guests, and no one else", async () => {
    const { orgA, orgB, lee, admin, member, system, description } = await setup();
    const event = admin.calendar.organize({
      title: TITLE,
      guests: [orgA.member.email, ADA],
      description,
    });
    await pollCalendar(system, admin.id);
    scriptInviteLearning(ADA_MEETING);
    await learnStoredItems(orgA.id);

    // The organizer, and a guest the organizer chose, even before the guest's calendar is read.
    expect((await readObject(orgA.admin.ctx, byAda)).facts.map((f) => f.statement)).toEqual([
      MEETING,
    ]);
    expect((await readObject(orgA.member.ctx, byAda)).facts.map((f) => f.statement)).toEqual([
      MEETING,
    ]);
    // No one else: a colleague on no invite, the org itself, another org.
    await expect(readObject(lee.ctx, byAda)).rejects.toThrow(NotFoundError);
    await expect(readObject(systemCtx(orgA.id), byAda)).rejects.toThrow(NotFoundError);
    await expect(readObject(orgB.admin.ctx, byAda)).rejects.toThrow(NotFoundError);

    // The guest's own copy links to the same facts, with no model call.
    member.calendar.receive(event);
    await pollCalendar(system, member.id);
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 2, facts: 1 }]);
    await expect(readObject(lee.ctx, byAda)).rejects.toThrow(NotFoundError);
  });

  it("shows an invite from outside to each guest once their own calendar holds it", async () => {
    const { orgA, lee, admin, member, system, description } = await setup();
    // Ada names the admin as a guest too, but only the member's calendar is known to hold it.
    const event = member.calendar.invite({
      title: TITLE,
      organizer: ADA,
      guests: [orgA.admin.email],
      description,
    });
    await pollCalendar(system, member.id);
    scriptInviteLearning(ADA_MEETING);
    await learnStoredItems(orgA.id);

    expect((await readObject(orgA.member.ctx, byAda)).facts).toHaveLength(1);
    await expect(readObject(orgA.admin.ctx, byAda)).rejects.toThrow(NotFoundError);
    await expect(readObject(lee.ctx, byAda)).rejects.toThrow(NotFoundError);

    admin.calendar.receive(event);
    await pollCalendar(system, admin.id);
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 2, facts: 1 }]);

    expect((await readObject(orgA.admin.ctx, byAda)).facts).toHaveLength(1);
    await expect(readObject(lee.ctx, byAda)).rejects.toThrow(NotFoundError);
  });
});

describe("polling calendars for memory", () => {
  it("reads every calendar granted Calendar once memory has started, and none before", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantOnly(orgA.id);
    const admin = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const system = systemCtx(orgA.id);

    // No Calendar-triggered workflow, and memory hasn't started.
    expect(await calendarsDue()).toEqual([]);
    expect(await pollCalendar(system, admin.id)).toEqual({ outcome: "skipped" });

    await startMemory(orgA.admin.ctx, { monthlyBudget: 1000 });
    expect(await calendarsDue()).toEqual([{ orgId: orgA.id, connectionId: admin.id }]);
    expect(await pollCalendar(system, admin.id)).toEqual({ outcome: "synced" });
    const event = admin.calendar.invite({ title: TITLE, organizer: ADA });
    // No workflow starts on it: there's none.
    expect(await pollCalendar(system, admin.id)).toEqual({ outcome: "polled", invites: 0 });

    expect(fakeInngest.sent("calendar/event.changed").map((sent) => sent.data)).toEqual([
      {
        orgId: orgA.id,
        connectionId: admin.id,
        app: "calendar",
        sourceRef: `${event.id}@0`,
        occurredAt: event.updated,
      },
    ]);
  });
});
