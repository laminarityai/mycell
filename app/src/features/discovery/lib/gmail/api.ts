// The Gmail API responses the connector reads, parsed with Zod. Shapes follow Google's
// reference for users.getProfile, users.messages.list and users.messages.get (format=full).
import { z } from "zod";

export const profileSchema = z.object({ emailAddress: z.string(), historyId: z.string() });

export const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional(),
  nextPageToken: z.string().optional(),
});

/** A MIME part of a message: the payload is one, and multipart parts nest more. */
export type MessagePart = {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { size?: number | undefined; data?: string | undefined } | undefined;
  parts?: MessagePart[] | undefined;
};

const messagePartSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ size: z.number().optional(), data: z.string().optional() }).optional(),
    parts: z.array(messagePartSchema).optional(),
  }),
);

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  // Milliseconds since the epoch, as a string.
  internalDate: z.string(),
  payload: messagePartSchema.optional(),
});
export type Message = z.infer<typeof messageSchema>;
