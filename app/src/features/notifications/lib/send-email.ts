// The one transactional email provider, Resend (docs/architecture.md, "Notifications"): its
// HTTP API, called with fetch, with every response parsed with Zod. Only this file talks to it.
import { z } from "zod";
import { env } from "@/env";
import type { Ctx } from "@/lib/ctx";
import type { Email } from "../types";

const RESEND_URL = "https://api.resend.com/emails";

const sent = z.object({ id: z.string().min(1) });
const refused = z.object({ message: z.string() }).partial();

/** Thrown when the provider doesn't take an email. A job retries the step that sent it. */
export class EmailSendError extends Error {
  constructor(status: number, message = "no message") {
    super(`Email provider refused the email (${String(status)}): ${message}`);
    this.name = "EmailSendError";
  }
}

/**
 * Sends one email from Mycel's address (`EMAIL_FROM`). `ctx` names who sends it, for the
 * record; the email carries only what its caller put in it. Throws EmailSendError when the
 * provider refuses it.
 */
export async function sendEmail(_ctx: Ctx, email: Email): Promise<void> {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(email.idempotencyKey === undefined ? {} : { "Idempotency-Key": email.idempotencyKey }),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.headers === undefined ? {} : { headers: email.headers }),
    }),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new EmailSendError(response.status, refused.parse(body).message);
  sent.parse(body);
}
