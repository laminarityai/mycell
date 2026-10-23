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
  // Each read stands alone, so they run at once.
  const [
    settings,
    spent,
    postponedItems,
    estimated,
    exclusions,
    companyWideLists,
    workspaceDomain,
    forgottenPeople,
  ] = await Promise.all([
    settingsOf(ctx),
    spentThisMonth(ctx),
    countPostponed(ctx),
    estimate(ctx),
    listExclusions(ctx),
    listCompanyWideLists(ctx),
    getWorkspaceDomain(ctx),
    countForgotten(ctx),
  ]);
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
    spentThisMonth: spent,
    postponedItems,
    estimate: estimated,
    exclusions,
    companyWideLists,
    workspaceDomain,
    forgottenPeople,
  };
}
