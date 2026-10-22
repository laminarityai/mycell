// How every Server Action runs (eslint.config.mjs holds `actions.ts` files to it): as the
// signed-in user, with its form parsed inside the `try`, so a stale or tampered form gets a
// message rather than a crash; a typed error becomes its message, with what the form sent so
// the form keeps it; and a refresh or redirect only once the write succeeded. It's an orgs entry
// because orgs owns `getCtx`.
import type { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import { formValues, parseForm, parseValue } from "@/lib/forms";
import { isRecord } from "@/lib/utils";
import { getCtx } from "./server";

export type ActionOptions<R, A> = {
  /** Form fields read as every value sent under the name, as `parseForm` reads them. */
  lists?: readonly string[];
  /**
   * Runs once `run` succeeded, outside the `try` so a redirect isn't taken for an error:
   * `refresh`, a redirect, or what to give the page from run's result. Without it, the page
   * gets what `run` returned.
   */
  after?: (result: R) => A;
};

/** What a successful action gives the page: an object `after` or `run` returned, or `{}`. */
type Done<A> = A extends object ? A : ActionResult;

/**
 * A Server Action on a form: `form` parsed with `schema`, then `run` with the signed-in user's
 * ctx, then `after`. A typed error becomes its message, with the fields the form sent; anything
 * else is a bug, rethrown (`actionError`).
 */
export async function runFormAction<T, R, A = R>(
  form: FormData,
  schema: z.ZodType<T>,
  run: (ctx: Ctx, input: T) => Promise<R>,
  options: ActionOptions<R, A> = {},
): Promise<Done<A> | ActionResult> {
  const { lists = [] } = options;
  return runAction(
    () => parseForm(schema, form, lists),
    run,
    options.after,
    () => formValues(form, lists),
  );
}

/** A Server Action a client component calls with a value (an ID, the spec being edited). */
export async function runValueAction<T, R, A = R>(
  value: unknown,
  schema: z.ZodType<T>,
  run: (ctx: Ctx, input: T) => Promise<R>,
  options: Omit<ActionOptions<R, A>, "lists"> = {},
): Promise<Done<A> | ActionResult> {
  return runAction(
    () => parseValue(schema, value),
    run,
    options.after,
    () => ({}),
  );
}

async function runAction<T, R, A>(
  parse: () => T,
  run: (ctx: Ctx, input: T) => Promise<R>,
  after: ((result: R) => A) | undefined,
  sent: () => ActionResult,
): Promise<Done<A> | ActionResult> {
  // Outside the `try`: with no session, it redirects to sign-in.
  const ctx = await getCtx();
  let result: R;
  try {
    result = await run(ctx, parse());
  } catch (error) {
    return { ...sent(), ...actionError(error) };
  }
  const answer = after === undefined ? result : after(result);
  return isRecord(answer) ? answer : {};
}
