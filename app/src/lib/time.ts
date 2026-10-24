/** A day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

// The clock. Server code reads the time from now(), never from `new Date()` or `Date.now()` (a
// lint rule), so a test can set it. Client components read the browser's own clock.
let setTime: Date | undefined;

/** The current time, or the time a test set. */
export function now(): Date {
  return setTime === undefined ? new Date() : new Date(setTime.getTime());
}

/** Tests only: holds now() at `time` until resetNow. The Vitest setup resets it before each test. */
export function setNow(time: Date): void {
  setTime = new Date(time.getTime());
}

/** Tests only: puts now() back on the real clock. */
export function resetNow(): void {
  setTime = undefined;
}
