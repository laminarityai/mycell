// The Inngest events discovery sends itself.
import { eventType } from "inngest";
import { z } from "zod";

/** One connection is due a poll: the polling cron sends one per `active` connection. */
export const connectionPollDue = eventType("discovery/connection.poll-due", {
  schema: z.object({ orgId: z.string().min(1), connectionId: z.string().min(1) }),
});
