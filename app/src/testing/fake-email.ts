// The fake email provider: Resend's send-email API behind msw's fetch interception, so code that
// sends email runs the real `sendEmail` without network or keys. It records what was sent, keeps
// one email per idempotency key as Resend does, and can be told to fail.
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { env } from "@/env";

const sendRequest = z.object({
  from: z.string().min(1),
  to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/** An email as Resend received it. */
export type FakeEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  idempotencyKey: string | null;
};

class FakeEmailProvider {
  private emails: FakeEmail[] = [];
  private failing = false;

  reset(): void {
    this.emails = [];
    this.failing = false;
  }

  /** Makes the next sends answer 500, until `failSends(false)` or the next reset. */
  failSends(failing = true): void {
    this.failing = failing;
  }

  /** The emails sent so far, oldest first, optionally only those to `to`. */
  sent(to?: string): FakeEmail[] {
    return this.emails.filter((email) => to === undefined || email.to.includes(to));
  }

  readonly handlers = [
    http.post("https://api.resend.com/emails", async ({ request }) => {
      if (request.headers.get("authorization") !== `Bearer ${env.RESEND_API_KEY}`) {
        return HttpResponse.json(
          { statusCode: 401, name: "missing_api_key", message: "Missing API key" },
          { status: 401 },
        );
      }
      if (this.failing) {
        return HttpResponse.json(
          { statusCode: 500, name: "internal_server_error", message: "Internal error" },
          { status: 500 },
        );
      }
      const body = sendRequest.safeParse(await request.json());
      if (!body.success) {
        return HttpResponse.json(
          { statusCode: 422, name: "validation_error", message: body.error.message },
          { status: 422 },
        );
      }
      const idempotencyKey = request.headers.get("idempotency-key");
      const earlier = this.emails.find(
        (email) => idempotencyKey !== null && email.idempotencyKey === idempotencyKey,
      );
      if (earlier !== undefined) return HttpResponse.json({ id: earlier.id });
      const id = `email-${String(this.emails.length + 1)}`;
      const { to, text = "", html = "", headers = {}, ...rest } = body.data;
      this.emails.push({
        ...rest,
        id,
        to: Array.isArray(to) ? to : [to],
        text,
        html,
        headers,
        idempotencyKey,
      });
      return HttpResponse.json({ id });
    }),
  ];
}

export const fakeEmail = new FakeEmailProvider();
