// Reading a Server Action's form, or the value a client component called it with
// (`runFormAction` calls these). A form that doesn't match its schema (a tampered or stale page)
// is the user's to fix by reloading, so it's a ValidationError: called inside the action's
// `try`, it comes back as a message rather than an unhandled ZodError.
import type { z } from "zod";
import { ValidationError, type ActionResult } from "./errors";

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

/**
 * A value a client component called an action with (an ID, the spec being edited), parsed with
 * `schema`, or ValidationError, as for a form.
 */
export function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Something was missing. Reload the page and try again.");
  }
  return parsed.data;
}

/**
 * The fields a form sent, read as `parseForm` reads them, for a failed action to hand back so
 * the form keeps them. Text only: a file isn't sent back.
 */
export function formValues(
  form: FormData,
  lists: readonly string[] = [],
): Pick<ActionResult, "values" | "lists"> {
  const values: Record<string, string> = {};
  for (const [name, value] of form) {
    if (typeof value === "string" && !lists.includes(name)) values[name] = value;
  }
  const listed = lists.map((name) => [name, form.getAll(name).filter(isText)] as const);
  return { values, lists: Object.fromEntries(listed) };
}

const isText = (value: FormDataEntryValue): value is string => typeof value === "string";
