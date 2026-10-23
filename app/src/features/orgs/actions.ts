"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { deleteMemberConnectionsOf } from "@/features/connections/server";
import { roleSchema } from "@/lib/ctx";
import { NotFoundError, type ActionResult } from "@/lib/errors";
import { runFormAction } from "./form-action";
import { reAddUser, removeUser, setRole } from "./server";

const setRoleInput = z.object({ userId: z.string().min(1), role: roleSchema });
const removeUserInput = z.object({ userId: z.string().min(1) });
const reAddUserInput = z.object({ removalId: z.string().min(1) });

export async function setRoleAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, setRoleInput, (ctx, { userId, role }) => setRole(ctx, userId, role), {
    after: refresh,
  });
}

/**
 * Removes a user, then deletes their member connections. Composed here, not in `removeUser`:
 * `connections` imports `orgs/server`, so `orgs/server` can't import `connections` back. Their
 * connections can only go once they're no longer a member, so if that second step fails, trying
 * again finds the user already removed and goes on to delete them.
 */
export async function removeUserAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    removeUserInput,
    async (ctx, { userId }) => {
      await removeUser(ctx, userId).catch((error: unknown) => {
        if (!(error instanceof NotFoundError)) throw error;
      });
      await deleteMemberConnectionsOf(ctx, userId);
    },
    { after: refresh },
  );
}

/** Lifts a removal: the person joins again as a member the next time they sign in. */
export async function reAddUserAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, reAddUserInput, (ctx, { removalId }) => reAddUser(ctx, removalId), {
    after: refresh,
  });
}
