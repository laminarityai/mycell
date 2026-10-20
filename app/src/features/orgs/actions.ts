"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { roleSchema } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import { getCtx, removeUser, setRole } from "./server";

const setRoleInput = z.object({ userId: z.string().min(1), role: roleSchema });
const removeUserInput = z.object({ userId: z.string().min(1) });

export async function setRoleAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const input = setRoleInput.parse(Object.fromEntries(form));
  try {
    await setRole(ctx, input.userId, input.role);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

export async function removeUserAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const input = removeUserInput.parse(Object.fromEntries(form));
  try {
    await removeUser(ctx, input.userId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
