import { describe, expect, it } from "vitest";
import { greet } from "../server";

describe("greet", () => {
  it("greets by name", () => {
    expect(greet("Ada")).toBe("Hello, Ada.");
  });

  it("ignores surrounding whitespace", () => {
    expect(greet("  Ada ")).toBe("Hello, Ada.");
  });

  it("falls back when the name is blank", () => {
    expect(greet("   ")).toBe("Hello.");
  });
});
