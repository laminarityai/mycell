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
import type { ToolDefinition } from "./tools";

const appIds = registeredApps.map((app) => `"${app.id}" (${app.name})`).join(", ");

export type DescribedCustomAction =
  | { ok: true; name: string; risk: string; message: string }
  | { ok: false; issues: string[]; message: string };

const NOT_ADDED = "Not added to the proposal. Fix every issue and describe it again.";

export const describeCustomActionTool: ToolDefinition<
  { action: Record<string, unknown> },
  DescribedCustomAction
> = {
  description:
    "Describe a custom action: one call to a registered app, for when no catalog action does " +
    "what the admin needs. `action` holds: name " +
    '(like "microsoft.read-message"), app (one of ' +
    appIds +
    '), description (one plain sentence), call ({ method: "GET" | "POST" | "PUT" | "PATCH", ' +
    "path, query, body } where path is " +
    'the path on the app with no host, such as "/v1.0/me/messages/{messageId}", with each ' +
    "{placeholder} an input, and query and body map each query parameter or body field to an " +
    "input), inputs (each " +
    'name to { type: "text" | "number" | "yes_no" | "choice", description, choices for a ' +
    'choice, optional }), outputs (for a read, each result field\'s name to { type: "text" | ' +
    '"number" | "yes_no", label, path }, path being property names and list indexes joined by ' +
    "dots into the response, such as from.emailAddress.address) and, for a write, editable " +
    "(the text inputs a person may edit before it's sent). Mycel sets its risk level by a " +
    "fixed rule; you may not choose one. A read runs on its own; any other call is a write, " +
    "which waits for a person to approve it every time it runs. On success, use it by name in " +
    "a tool step of the spec " +
    "you send to propose_spec in this turn. It is stored only if the admin accepts that " +
    "proposal, and a stored custom action never changes: a changed one needs a new name.",
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
          issues: [
            `The company already has a custom action named "${name}" that does something else, and a stored custom action never changes. Give the changed one a new name, such as "${name}-v2".`,
          ],
          message: NOT_ADDED,
        };
      }
      return {
        ok: true,
        name,
        risk,
        message: "The company already has this custom action: use it by name in propose_spec.",
      };
    }
    turn.customActions = [...turn.customActions.filter((each) => each.name !== name), check.action];
    return {
      ok: true,
      name,
      risk,
      message:
        `Added to this turn's proposal as "${name}", at risk level ${risk}, set by Mycel's ` +
        "rule. Use it by name in a tool step of the spec you send to propose_spec.",
    };
  },
};
