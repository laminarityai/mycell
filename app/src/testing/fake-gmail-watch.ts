// Gmail's users.watch on a fake mailbox, in the shape Google documents: the request names the
// Pub/Sub topic Gmail publishes to and a label filter, and the answer is the mailbox's current
// history ID and when the watch expires, in milliseconds since the epoch as a string, 7 days
// out. Asking again replaces the watch. Any scope that reads Gmail may watch it (the proxy checks
// that); a test can make Gmail refuse a watch as it does when the topic won't let it publish.
import { HttpResponse } from "msw";
import { z } from "zod";

const WATCH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// The fields users.watch takes. Google refuses any other with 400.
const watchRequest = z.strictObject({
  topicName: z.string(),
  labelIds: z.array(z.string()).optional(),
  labelFilterBehavior: z.enum(["include", "exclude"]).optional(),
  // The older name for labelFilterBehavior, ignored when that's set.
  labelFilterAction: z.enum(["include", "exclude"]).optional(),
});

/** A users.watch request a mailbox received, and the expiry it answered with. */
export type FakeWatch = z.infer<typeof watchRequest> & { expiration: string };

/** The watches asked of one mailbox. */
export class FakeGmailWatches {
  /** Every watch made, in order (refused ones aren't). */
  readonly made: FakeWatch[] = [];
  private refusals = 0;

  /**
   * The next watch is refused with 403, as Gmail refuses one when the topic doesn't let
   * gmail-api-push@system.gserviceaccount.com publish to it.
   */
  refuseNext(): void {
    this.refusals += 1;
  }

  /** users.watch, given the mailbox's current history ID and the request's JSON body. */
  answer(historyId: string, body: unknown): Response {
    const request = watchRequest.safeParse(body);
    if (!request.success || !/^projects\/[^/]+\/topics\/[^/]+$/.test(request.data.topicName)) {
      return error(400, "INVALID_ARGUMENT", "Invalid topicName or request.");
    }
    if (this.refusals > 0) {
      this.refusals -= 1;
      const message = `Error sending test message to Cloud PubSub ${request.data.topicName} : User not authorized to perform this action.`;
      return error(403, "PERMISSION_DENIED", message);
    }
    const expiration = String(Date.now() + WATCH_DAYS * DAY_MS);
    this.made.push({ ...request.data, expiration });
    return HttpResponse.json({ historyId, expiration });
  }
}

function error(code: number, status: string, message: string) {
  return HttpResponse.json({ error: { code, message, status } }, { status: code });
}
