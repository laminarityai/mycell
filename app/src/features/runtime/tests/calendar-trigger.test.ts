// The Calendar trigger (M11, #70): a poll every minute per calendar a Calendar-triggered
// workflow watches, with Calendar's sync token, announcing each new invite once; the fan-out
// starts one run per workflow switched on for that connection.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { disable } from "@/features/workflows/server";
import { deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { getRunMessage, listRuns, pollCalendar, startInviteRuns } from "../server";
import { announced, announcedIds, calendarSwitchedOn } from "./calendar-helpers";

beforeEach(resetDatabase);

describe("polling a calendar for new invites", () => {
  it("syncs first, starting nothing, then announces a new invite once with its pointers", async () => {
    const { system, google, calendar } = await calendarSwitchedOn();

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "synced" });
    expect(announced()).toEqual([]);

    const invite = calendar.invite({ title: "Pricing call", organizer: "ada@customer.test" });
    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 1 });
    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 0 });

    expect(announced()).toEqual([
      {
        orgId: system.orgId,
        connectionId: google.id,
        sourceRef: invite.id,
        occurredAt: invite.created,
      },
    ]);
  });

  it("starts one run per workflow switched on for the connection", async () => {
    const { system, admin, google, calendar, workflowIds } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    const invite = calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    await pollCalendar(system, google.id);

    const { runIds } = await startInviteRuns(system, announced()[0]);

    expect(runIds).toHaveLength(2);
    for (const workflowId of workflowIds) {
      const { runs } = await listRuns(admin.ctx, { workflowId });
      expect(
        runs.map((run) => ({ connectionId: run.connectionId, sourceRef: run.message?.sourceRef })),
      ).toEqual([{ connectionId: google.id, sourceRef: invite.id }]);
    }
  });

  it("shows a run's invite on the Runs page and the run's page: its title, organizer and link", async () => {
    const { system, admin, google, calendar, workflowIds } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    const invite = calendar.invite({
      title: "Intro call",
      organizer: "ada@customer.test",
      description: "Agenda: pricing",
    });
    await pollCalendar(system, google.id);
    const { runIds } = await startInviteRuns(system, announced()[0]);

    const shown = {
      sourceRef: invite.id,
      subject: "Intro call",
      from: "ada@customer.test",
      link: invite.htmlLink,
    };
    const [listed] = (await listRuns(admin.ctx, { workflowId: workflowIds[0] })).runs;
    expect(listed.message).toEqual(shown);
    expect(await getRunMessage(admin.ctx, runIds[0] ?? "")).toEqual(shown);
  });

  it("starts nothing more for an invite listed again after its organizer changes it", async () => {
    const { system, admin, google, calendar, workflowIds } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    const invite = calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    await pollCalendar(system, google.id);
    const first = await startInviteRuns(system, announced()[0]);

    calendar.edit(invite.id, { title: "Intro (moved)" });
    await pollCalendar(system, google.id);
    const again = await startInviteRuns(system, announced()[1]);

    // Announced under the same event ID, which Inngest takes once.
    expect(new Set(announcedIds()).size).toBe(1);
    expect(again.runIds).toEqual(first.runIds);
    for (const workflowId of workflowIds) {
      expect((await listRuns(admin.ctx, { workflowId })).runs).toHaveLength(1);
    }
  });

  it("announces nothing for invites that aren't new to the person", async () => {
    let old = "";
    const { system, google, calendar } = await calendarSwitchedOn((early) => {
      const at = new Date(Date.now() - 1000);
      old = early.invite({ title: "Old", organizer: "bob@customer.test", at }).id;
    });
    await pollCalendar(system, google.id);

    // From before the switch-on, listed now because its organizer changed it.
    calendar.edit(old, { title: "Old, moved" });
    // One the person organised themselves.
    calendar.organize({ title: "Our sync", guests: ["ada@customer.test"] });
    // Cancelled before the poll saw it.
    calendar.cancel(calendar.invite({ title: "Gone", organizer: "ada@customer.test" }).id);
    // Added by Gmail from an email, and one whose guests Google left out.
    calendar.invite({ title: "Flight", organizer: "ada@customer.test", eventType: "fromGmail" });
    calendar.invite({ title: "Big", organizer: "ada@customer.test", attendeesOmitted: true });
    // Already answered.
    calendar.respond(
      calendar.invite({ title: "Yes", organizer: "ada@customer.test" }).id,
      "accepted",
    );

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 0 });
    expect(announced()).toEqual([]);
  });

  it("announces nothing when an announced invite is cancelled", async () => {
    const { system, google, calendar } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    const invite = calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    await pollCalendar(system, google.id);

    calendar.cancel(invite.id);

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 0 });
    expect(announced()).toHaveLength(1);
  });

  it("resyncs without announcing anything when Google expires the sync token", async () => {
    const { system, google, calendar } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    calendar.expireSyncTokens();
    calendar.invite({ title: "During the gap", organizer: "ada@customer.test" });

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "synced" });
    expect(announced()).toEqual([]);

    const next = calendar.invite({ title: "After", organizer: "ada@customer.test" });
    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 1 });
    expect(announced().map((invite) => invite.sourceRef)).toEqual([next.id]);
  });

  it("asks every list request the same, never combining the sync token with a filter", async () => {
    const { system, google, calendar } = await calendarSwitchedOn((early) => {
      for (let i = 0; i < 260; i++) early.invite({ title: `Old ${String(i)}`, organizer: "a@b.c" });
    });
    await pollCalendar(system, google.id);
    for (let i = 0; i < 260; i++)
      calendar.invite({ title: `New ${String(i)}`, organizer: "a@b.c" });
    calendar.expireSyncTokens();
    await pollCalendar(system, google.id);
    calendar.invite({ title: "Last", organizer: "a@b.c" });
    await pollCalendar(system, google.id);

    const requests = calendar.listRequests;
    // Two pages for the first sync; the expired token, then three pages of the sync again; and
    // what changed since.
    expect(requests.map((params) => [params.has("syncToken"), params.has("pageToken")])).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [false, false],
      [false, true],
      [false, true],
      [true, false],
    ]);
    const asked = requests.map((params) => {
      const rest = new URLSearchParams(params);
      rest.delete("syncToken");
      rest.delete("pageToken");
      return rest.toString();
    });
    expect(new Set(asked).size).toBe(1);
    for (const filter of ["timeMin", "timeMax", "updatedMin", "q", "orderBy"]) {
      expect(requests.some((params) => params.has(filter))).toBe(false);
    }
  });

  it("announces every new invite across pages", async () => {
    const { system, google, calendar } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    for (let i = 0; i < 260; i++)
      calendar.invite({ title: `New ${String(i)}`, organizer: "a@b.c" });

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "polled", invites: 260 });
  });

  it("skips a calendar with no Calendar-triggered workflow switched on", async () => {
    const { system, admin, google, calendar, workflowIds } = await calendarSwitchedOn();
    for (const workflowId of workflowIds) await disable(admin.ctx, workflowId);
    calendar.invite({ title: "Intro", organizer: "ada@customer.test" });

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "skipped" });
    expect(calendar.listRequests).toEqual([]);
  });

  it("skips a connection needing reauthorization", async () => {
    const { system, google, calendar } = await calendarSwitchedOn();
    await deliver(fakeNango.authWebhook(google.nangoConnectionId, "refresh", false));

    expect(await pollCalendar(system, google.id)).toEqual({ outcome: "skipped" });
    expect(calendar.listRequests).toEqual([]);
  });

  it("starts nothing for an invite made before the workflows were switched on", async () => {
    const { system, admin, google, calendar, workflowIds } = await calendarSwitchedOn();
    await pollCalendar(system, google.id);
    const invite = calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    await pollCalendar(system, google.id);

    const { runIds } = await startInviteRuns(system, {
      ...announced()[0],
      occurredAt: new Date(Date.parse(invite.created) - 60_000).toISOString(),
    });

    expect(runIds).toEqual([]);
    expect((await listRuns(admin.ctx, { workflowId: workflowIds[0] })).runs).toEqual([]);
  });
});
