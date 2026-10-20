// Reading a Server Action's form. A form that doesn't match its schema (a tampered or stale
// page) is the user's to fix by reloading, so it's a ValidationError: called inside the
// action's `try`, it comes back as a message rather than an unhandled ZodError.
import type { z } from "zod";
import { ValidationError } from "./errors";

/** The form's fields parsed with `schema`, or ValidationError. */
export function parseForm<T>(schema: z.ZodType<T>, form: FormData): T {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    throw new ValidationError("The form was missing something. Reload the page and try again.");
  }
  return parsed.data;
}
