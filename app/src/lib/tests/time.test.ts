import { describe, expect, it } from "vitest";
import { now, resetNow, setNow } from "@/lib/time";

describe("the clock", () => {
  it("reads the real time unless a test sets it", () => {
    const before = Date.now();
    const read = now().getTime();
    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(Date.now());
  });

  it("stays at the time a test sets until it's reset", () => {
    setNow(new Date("2026-03-01T09:30:00Z"));

    expect(now().toISOString()).toBe("2026-03-01T09:30:00.000Z");
    expect(now().toISOString()).toBe("2026-03-01T09:30:00.000Z");

    resetNow();
    expect(now().getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(now().toISOString()).not.toBe("2026-03-01T09:30:00.000Z");
  });

  it("hands out a copy, so changing one reading changes no other", () => {
    const set = new Date("2026-03-01T09:30:00Z");
    setNow(set);

    now().setUTCFullYear(2000);
    set.setUTCFullYear(2001);

    expect(now().toISOString()).toBe("2026-03-01T09:30:00.000Z");
  });

  it("starts each test on the real clock again", () => {
    // The previous test left it set; the Vitest setup resets it before each test.
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(60_000);
  });
});
