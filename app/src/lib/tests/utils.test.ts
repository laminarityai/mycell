import { describe, expect, it } from "vitest";
import { unique } from "../utils";

describe("unique", () => {
  it("keeps each string once, in the order first seen", () => {
    expect(unique(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("keeps each object once by its id, the first one seen", () => {
    const first = { id: "a", rank: 1 };
    const again = { id: "a", rank: 2 };
    const other = { id: "b", rank: 3 };
    expect(unique([first, other, again])).toEqual([first, other]);
  });
});
