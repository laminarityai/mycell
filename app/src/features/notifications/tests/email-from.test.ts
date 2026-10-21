// EMAIL_FROM, which every email is sent from: an address, alone or with a display name.
import { describe, expect, it } from "vitest";
import { emailSenderSchema } from "@/env";

describe("EMAIL_FROM", () => {
  it("takes an address, alone or with a display name", () => {
    for (const from of [
      "reviews@mail.example.com",
      "Mycel <reviews@mail.example.com>",
      '"Mycel Reviews" <reviews@mail.example.com>',
    ]) {
      expect(emailSenderSchema.safeParse(from).success).toBe(true);
    }
  });

  it("refuses anything that isn't an address", () => {
    for (const from of [
      "",
      "Mycel",
      "Mycel <>",
      "Mycel <reviews>",
      "reviews@",
      "Mycel reviews@mail.example.com",
      "<reviews@mail.example.com",
      "Mycel <reviews@mail.example.com> extra",
    ]) {
      expect(emailSenderSchema.safeParse(from).success).toBe(false);
    }
  });
});
