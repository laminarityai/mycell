import { describe, expect, it } from "vitest";
import { emailAddressesIn } from "../email-addresses";

describe("emailAddressesIn", () => {
  it("finds every address, lowercased, once each, in order", () => {
    expect(
      emailAddressesIn("Ada <Ada@Example.test>, bob+billing@mail.example.co.uk; ada@example.test"),
    ).toEqual(["ada@example.test", "bob+billing@mail.example.co.uk"]);
  });

  it("keeps an apostrophe inside the local part", () => {
    expect(emailAddressesIn("Write to Pat.O'Brien@example.test")).toEqual([
      "pat.o'brien@example.test",
    ]);
  });

  it("leaves out the quotes around a quoted address", () => {
    expect(emailAddressesIn("Mail 'ada@example.test' or \"bob@example.test\"")).toEqual([
      "ada@example.test",
      "bob@example.test",
    ]);
  });

  it("doesn't take a Content-ID for an address", () => {
    expect(emailAddressesIn("cid:image001.png@01D9A1B2.C3D4E5F0")).toEqual([]);
  });
});
