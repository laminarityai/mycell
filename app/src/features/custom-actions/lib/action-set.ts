// A company's action set (ADR-0018): every action its workflows may use. Saving, checking and
// publishing a workflow, running it, Try it and the builder chat each resolve it once and hand
// it to the policy engine and everything else that looks an action up.
import { catalogActionSet } from "@/features/policy/catalog";
import type { ActionSet } from "@/features/policy/types";
import type { Ctx } from "@/lib/ctx";

/**
 * The actions the caller's company may use. Until custom actions are stored, every company's
 * set is the catalog, so it doesn't read `ctx` yet.
 */
export const getActionSet: (ctx: Ctx) => Promise<ActionSet> = () =>
  Promise.resolve(catalogActionSet);
