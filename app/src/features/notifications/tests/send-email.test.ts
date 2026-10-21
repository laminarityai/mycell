// Sending one email through the transactional email provider (the fake Resend in tests).
import { describe, expect, it } from "vitest";
import { systemCtx } from "@/lib/ctx";
import { fakeEmail } from "@/testing/fake-email";
import { sendEmail } from "../server";

const ctx = systemCtx("org-1");
const email = {
  to: "ada@org-a.test",
  subject: "2 reviews are waiting for you",
  text: "Open Mycel to see them.",
  html: "<p>Open Mycel to see them.</p>",
};

describe("sendEmail", () => {
  it("sends the email from Mycel's address", async () => {
    await sendEmail(ctx, email);

    expect(fakeEmail.sent()).toEqual([
      expect.objectContaining({
        from: "Mycel <reviews@mycel.test>",
        to: ["ada@org-a.test"],
        subject: "2 reviews are waiting for you",
        text: "Open Mycel to see them.",
        html: "<p>Open Mycel to see them.</p>",
      }),
    ]);
  });

  it("sends an email once per idempotency key, however often it's retried", async () => {
    await sendEmail(ctx, { ...email, idempotencyKey: "digest/org-1/user-1/2026-10-21" });
    await sendEmail(ctx, { ...email, idempotencyKey: "digest/org-1/user-1/2026-10-21" });
    await sendEmail(ctx, { ...email, idempotencyKey: "digest/org-1/user-1/2026-10-22" });

    expect(fakeEmail.sent()).toHaveLength(2);
  });

  it("passes on headers such as List-Unsubscribe", async () => {
    await sendEmail(ctx, {
      ...email,
      headers: { "List-Unsubscribe": "<https://mycel.test/unsubscribe?token=t>" },
    });

    expect(fakeEmail.sent().at(0)?.headers).toEqual({
      "List-Unsubscribe": "<https://mycel.test/unsubscribe?token=t>",
    });
  });

  it("throws when the provider refuses the email, so a job retries it", async () => {
    fakeEmail.failSends();

    await expect(sendEmail(ctx, email)).rejects.toThrow(/Email provider/);
    expect(fakeEmail.sent()).toEqual([]);
  });
});
