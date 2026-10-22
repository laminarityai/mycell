// Without these, a page that throws or calls notFound() shows Next's bare page, with no way
// back into the app.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = join(import.meta.dirname, "..");

describe("the app's error pages", () => {
  it.each(["error.tsx", "not-found.tsx", "global-error.tsx"])("include %s", (file) => {
    expect(existsSync(join(APP_DIR, file))).toBe(true);
  });
});
