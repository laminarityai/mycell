// A company's action set (ADR-0018): the actions its workflows may use, looked up by name.
// `custom-actions` resolves one per company; everything that looks an action up takes it.
// Pure: no IO, no ctx, so client code may import it.
import type { Action, ActionSet } from "./types";

/** An action set of `actions`, in their order. */
export function actionSetOf(actions: readonly Action[]): ActionSet {
  const byName = new Map(actions.map((action) => [action.name, action]));
  return { actions, find: (name) => byName.get(name) };
}

/**
 * The apps a workflow calling `actionNames` uses, as admins name them: Gmail, whose new mail
 * every workflow's trigger watches, then each action's app, each once. An action on what Mycel
 * itself holds (memory) uses no app.
 */
export function appsUsed(actionNames: readonly string[], actions: ActionSet): Action["app"][] {
  const apps = actionNames.flatMap((name) => {
    const action = actions.find(name);
    return action === undefined || isMycelAction(action) ? [] : [action.app];
  });
  return [...new Set<Action["app"]>(["Gmail", ...apps])];
}

/**
 * The scopes the action needs of the connection a run is on, as lists any one scope of which
 * allows it: one list for a Google catalog action, none for one on what Mycel holds, and none
 * for a custom action, which reaches its own app through a connection to that app.
 */
export function scopesOf(action: Action): (readonly string[])[] {
  return action.kind === "catalog" && action.integration === "google" ? [action.scopes] : [];
}

function isMycelAction(action: Action): boolean {
  return action.kind === "catalog" && action.integration === "mycel";
}
