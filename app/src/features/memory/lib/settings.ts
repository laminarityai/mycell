// Memory's settings page, read in one call: whether memory started, its budget and retention
// window, this month's spending, the estimate, the exclusions and company-wide lists, and how
// many people were forgotten. Admins only: members have no view of memory.
import { getWorkspaceDomain } from "@/features/orgs/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { MemorySettings } from "../types";
import { countPostponed, estimate, monthStart, settingsOf, spentThisMonth } from "./budget";
import { listCompanyWideLists } from "./company-wide-lists";
import { listExclusions } from "./exclusions";
import { countForgotten } from "./forget";

export async function getMemorySettings(ctx: Ctx): Promise<MemorySettings> {
  requireAdmin(ctx);
  const settings = await settingsOf(ctx);
  return {
    started:
      settings === null
        ? null
        : {
            startedAt: settings.startedAt,
            monthlyBudget: settings.monthlyBudget,
            retentionMonths: settings.retentionMonths,
          },
    monthStart: monthStart(),
    spentThisMonth: await spentThisMonth(ctx),
    postponedItems: await countPostponed(ctx),
    estimate: await estimate(ctx),
    exclusions: await listExclusions(ctx),
    companyWideLists: await listCompanyWideLists(ctx),
    workspaceDomain: await getWorkspaceDomain(ctx),
    forgottenPeople: await countForgotten(ctx),
  };
}
