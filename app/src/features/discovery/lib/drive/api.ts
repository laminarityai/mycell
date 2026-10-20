// The Drive API responses the connector reads, parsed with Zod. Shapes follow Google's reference
// for changes.getStartPageToken, files.list and changes.list (Drive API v3). Every request names
// its `fields`, and none asks for a file's name: Drive never sends Mycel one (invariant 8).
import { z } from "zod";

/** The file fields the connector asks for, wherever a file resource appears. */
export const FILE_FIELDS =
  "id, mimeType, createdTime, modifiedTime, lastModifyingUser(emailAddress), owners(emailAddress)";

/** In the changes feed, also whether the change put the file in the trash. */
export const CHANGED_FILE_FIELDS = `${FILE_FIELDS}, trashed`;

const user = z.object({ emailAddress: z.string().optional() });

export const fileSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  createdTime: z.string(),
  modifiedTime: z.string(),
  trashed: z.boolean().optional(),
  lastModifyingUser: user.optional(),
  owners: z.array(user).optional(),
});
export type DriveFile = z.infer<typeof fileSchema>;

export const startPageTokenSchema = z.object({ startPageToken: z.string() });

export const fileListSchema = z.object({
  files: z.array(fileSchema).optional(),
  nextPageToken: z.string().optional(),
});

// A page of the changes feed has either the next page's token, or (on the last page) the token
// the next poll starts from.
export const changeListSchema = z.object({
  changes: z
    .array(
      z.object({
        changeType: z.string().optional(),
        removed: z.boolean().optional(),
        fileId: z.string().optional(),
        file: fileSchema.optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  newStartPageToken: z.string().optional(),
});

// Google's error body: Drive answers an invalid or expired page token with 400 and an error
// whose location is the `pageToken` parameter.
const errorBody = z.object({
  error: z.object({
    errors: z.array(z.object({ location: z.string().optional() })).optional(),
  }),
});

/** Whether Drive's error body blames the page token. */
export function blamesPageToken(body: unknown): boolean {
  const parsed = errorBody.safeParse(body);
  return parsed.success && (parsed.data.error.errors ?? []).some((e) => e.location === "pageToken");
}
