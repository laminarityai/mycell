// Reading a Server Action's form. A form that doesn't match its schema (a tampered or stale
// page) is the user's to fix by reloading, so it's a ValidationError: called inside the
// action's `try`, it comes back as a message rather than an unhandled ZodError.
import type { z } from "zod";
import { ValidationError } from "./errors";

/**
 * The form's fields parsed with `schema`, or ValidationError. Each field is one value, except
 * those named in `lists`, which are every value sent under that name (none gives an empty list),
 * as a group of checkboxes sends them.
 */
export function parseForm<T>(
  schema: z.ZodType<T>,
  form: FormData,
  lists: readonly string[] = [],
): T {
  const fields: Record<string, unknown> = Object.fromEntries(form);
  for (const name of lists) fields[name] = form.getAll(name);
  const parsed = schema.safeParse(fields);
  if (!parsed.success) {
    throw new ValidationError("The form was missing something. Reload the page and try again.");
  }
  return parsed.data;
}
