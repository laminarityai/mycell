// The one transactional email provider, Resend (docs/architecture.md, "Notifications"): its
// HTTP API, called with fetch, with every response parsed with Zod. Only this file talks to it.
import { z } from "zod";
import { env } from "@/env";
import type { Ctx } from "@/lib/ctx";
import { EmailSendError } from "@/lib/errors";
import type { Email } from "../types";

const RESEND_URL = "https://api.resend.com/emails";

const sent = z.object({ id: z.string().min(1) });
const refused = z.object({ message: z.string() }).partial();

/**
 * Sends one email from Mycel's address (`EMAIL_FROM`). It takes the caller's `ctx` first, like
 * every server function, but sends nothing of it: the email carries only what its caller put in
 * it. Throws EmailSendError when the provider refuses it, so the job sending it retries.
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
