// describe_custom_action: when no catalog action fits but one call to a registered app would,
// the agent describes that call (ADR-0018). The description is checked and given its level by
// the fixed rule, and joins the turn's proposal: propose_spec may then use it by name, and it is
// stored only if the admin accepts that proposal.
import { z } from "zod";
import { registeredApps } from "@/features/connections/registered-apps";
import { checkCustomAction } from "@/features/custom-actions/description";
import { listCustomActions } from "@/features/custom-actions/server";
import { sameValue } from "@/features/spec/diff";
import { requireAdmin } from "@/lib/ctx";
import { joinPrompts } from "@/lib/prompts";
import { toolPrompts, toolResultPrompts } from "./prompts";
import type { ToolDefinition } from "./tools";

const apps = joinPrompts(
  registeredApps.map((app) => toolPrompts.app({ id: app.id, name: app.name })),
  ", ",
);

export type DescribedCustomAction =
  | { ok: true; name: string; risk: string; message: string }
  | { ok: false; issues: string[]; message: string };

const NOT_ADDED = toolResultPrompts.customActionNotAdded();

export const describeCustomActionTool: ToolDefinition<
  { action: Record<string, unknown> },
  DescribedCustomAction
> = {
  description: toolPrompts.describeCustomAction({ apps }),
  inputSchema: z.object({ action: z.record(z.string(), z.unknown()) }),
  async execute(ctx, { action }, turn) {
    requireAdmin(ctx);
    const check = checkCustomAction(action);
    if (!check.ok) return { ok: false, issues: check.issues, message: NOT_ADDED };
    const { name, risk } = check.action;
    const stored = (await listCustomActions(ctx)).find((each) => each.name === name);
    if (stored !== undefined) {
      const { app, description, call, inputs, outputs, editable } = stored;
      const record = { name, app, description, call, inputs, outputs, editable, risk: stored.risk };
      if (!sameValue(record, check.action)) {
        return {
          ok: false,
          issues: [toolResultPrompts.customActionNameTaken({ name })],
          message: NOT_ADDED,
        };
      }
      return {
        ok: true,
        name,
        risk,
        message: toolResultPrompts.customActionStored(),
      };
    }
    turn.customActions = [...turn.customActions.filter((each) => each.name !== name), check.action];
    return {
      ok: true,
      name,
      risk,
      message: toolResultPrompts.customActionAdded({ name, risk }),
    };
  },
};
