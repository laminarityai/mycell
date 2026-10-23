// Booking a meeting invites guests, so it's an external send (ADR-0013): a tool step may make the
// event, which waits on the person's calendar with no guests, and the engine inserts a
// `calendar_events` approval right after it when nothing on its own path reviews it.
import { describe, expect, it } from "vitest";
import { findStep } from "@/features/spec/tree";
import { googleScope } from "@/lib/google";
import { actionsAllowedBy, catalog, catalogActionSet } from "../catalog";
import { applyPolicy } from "../engine";
import { specWithSteps } from "./specs";

const book = {
  id: "book",
  type: "tool",
  action: "google-calendar.create-event",
  input: {
    title: "Intro call",
    start: "2026-11-02T15:00:00+00:00",
    end: "2026-11-02T15:30:00+00:00",
    guests: ["ada@customer.test"],
  },
};

describe("the Calendar actions", () => {
  it("read an event at read risk and book one at external_send, waiting as an event", () => {
    expect(catalog["google-calendar.read-event"]).toMatchObject({ app: "Calendar", risk: "read" });
    expect(catalog["google-calendar.create-event"]).toMatchObject({
      app: "Calendar",
      risk: "external_send",
      channel: "calendar_events",
      pendingForm: expect.stringContaining("no guests") as string,
    });
  });

  it("need Calendar: reading takes any Calendar scope, booking a read-write one", () => {
    const names = (scopes: string[]) =>
      actionsAllowedBy(scopes)
        .map((action) => action.name)
        .filter((name) => name.startsWith("google-calendar."));

    expect(names([googleScope("calendar.events")])).toEqual([
      "google-calendar.read-event",
      "google-calendar.create-event",
    ]);
    expect(names([googleScope("calendar.readonly")])).toEqual(["google-calendar.read-event"]);
    expect(names([googleScope("gmail.modify")])).toEqual([]);
  });
});

describe("a booking in a tool step", () => {
  it("gets a calendar_events approval inserted right after it", () => {
    const result = applyPolicy(specWithSteps([book]), catalogActionSet);

    expect(result).toMatchObject({
      ok: true,
      maxRisk: "external_send",
      inserted: [
        { stepId: "book-approval", after: "book", action: "google-calendar.create-event" },
      ],
    });
    if (!result.ok) return;
    expect(findStep(result.spec, "book-approval")).toEqual({
      id: "book-approval",
      type: "approval",
      channel: "calendar_events",
    });
  });

  it("needs nothing inserted when a calendar_events approval follows it on its path", () => {
    const spec = specWithSteps([
      book,
      { id: "check", type: "approval", channel: "calendar_events" },
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({ ok: true, spec, inserted: [] });
  });

  it("isn't reviewed by an approval of Gmail drafts", () => {
    const spec = specWithSteps([book, { id: "check", type: "approval", channel: "gmail_drafts" }]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({
      ok: true,
      inserted: [{ stepId: "book-approval" }],
    });
  });

  it("refuses a booking as a draft's output, and a Gmail draft in a tool step still", () => {
    const spec = specWithSteps([
      {
        id: "draft",
        type: "draft",
        role: "smart",
        instructions: "Book it.",
        context: ["trigger.message"],
        output: "google-calendar.create-event",
      },
      {
        id: "send",
        type: "tool",
        action: "google-mail.create-draft",
        input: { messageId: { from: "trigger.messageId" } },
      },
    ]);

    expect(applyPolicy(spec, catalogActionSet)).toMatchObject({
      ok: false,
      issues: [
        { path: ["steps", 0, "output"], message: expect.stringContaining("tool step") as string },
        { path: ["steps", 1, "action"], message: expect.stringContaining("draft") as string },
      ],
    });
  });

  it("refuses a literal input Calendar wouldn't take, such as a blank title", () => {
    const spec = specWithSteps([
      {
        ...book,
        input: { ...book.input, title: "  ", meet: "yes" },
      },
    ]);

    const result = applyPolicy(spec, catalogActionSet);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path.at(-1))).toEqual(["title", "meet"]);
  });
});
