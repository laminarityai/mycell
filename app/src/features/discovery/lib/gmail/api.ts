// The Gmail API responses only the connector reads, parsed with Zod. Shapes follow Google's
// reference for users.getProfile and users.history.list; messages are read with connections'
// Gmail schemas.
import { z } from "zod";

export const profileSchema = z.object({ emailAddress: z.string(), historyId: z.string() });

const historyMessage = z.object({ message: z.object({ id: z.string() }) });

// Only the parts polling reads: which messages each record added, deleted for good, or gave
// which labels.
export const historyListSchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string(),
        messagesAdded: z.array(historyMessage).optional(),
        messagesDeleted: z.array(historyMessage).optional(),
        labelsAdded: z
          .array(historyMessage.extend({ labelIds: z.array(z.string()).optional() }))
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  // The mailbox's current history ID: where the next poll starts.
  historyId: z.string(),
});

// users.watch's answer: the mailbox's history ID, and when the watch expires, in milliseconds
// since the epoch, as a string.
export const watchSchema = z.object({
  historyId: z.string(),
  expiration: z.string().regex(/^\d+$/),
});
