// Memory's settings page, read in one call: whether memory started and its budget, this month's
// spending, the estimate and the exclusions. Admins only: members have no view of memory.
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { MemorySettings } from "../types";
import { countPostponed, estimate, monthStart, settingsOf, spentThisMonth } from "./budget";
import { listExclusions } from "./exclusions";

export async function getMemorySettings(ctx: Ctx): Promise<MemorySettings> {
  if (ctx.role === "member") throw new ForbiddenError();
  const settings = await settingsOf(ctx);
  return {
    started:
      settings === null
        ? null
        : { startedAt: settings.startedAt, monthlyBudget: settings.monthlyBudget },
    monthStart: monthStart(),
    spentThisMonth: await spentThisMonth(ctx),
    postponedItems: await countPostponed(ctx),
    estimate: await estimate(ctx),
    exclusions: await listExclusions(ctx),
  };
}
