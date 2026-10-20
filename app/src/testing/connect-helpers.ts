import type { Ctx } from "@/lib/ctx";
import { fakeNango } from "@/testing/fake-nango";
import { handleNangoWebhook, startConnect } from "@/features/connections/server";

/** The whole connect flow: start an attempt, finish OAuth as `emailAddress`, deliver the webhook. */
export async function connectGmail(ctx: Ctx, emailAddress: string) {
  const { token } = await startConnect(ctx, "gmail");
  const webhook = fakeNango.completeConnect(token, { emailAddress });
  const response = await handleNangoWebhook(webhook.rawBody, webhook.headers);
  return { ...webhook, response };
}

/** The same flow for a shared inbox, connected as an org connection. */
export async function connectOrgInbox(ctx: Ctx, emailAddress: string) {
  const { token } = await startConnect(ctx, "gmail", "org");
  const webhook = fakeNango.completeConnect(token, { emailAddress });
  const response = await handleNangoWebhook(webhook.rawBody, webhook.headers);
  return { ...webhook, response };
}
