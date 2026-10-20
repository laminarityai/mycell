// The one Inngest client. Features define their functions in their jobs.ts, and the one Inngest
// route (src/app/api/inngest/route.ts) serves them all.
import { Inngest } from "inngest";
import { env } from "@/env";

export const inngest = new Inngest({
  id: "mycel",
  isDev: env.INNGEST_DEV,
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
});
