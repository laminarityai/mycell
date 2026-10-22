// An org's action set (ADR-0018): the actions its workflows may use, looked up by name.
// `custom-actions` resolves one per org; everything that looks an action up takes it.
// Pure: no IO, no ctx, so client code may import it.
import type { Action, ActionSet } from "./types";

/**
 * An action set of `actions`, in their order. The first action of a name wins, and later ones of
 * the same name are left out: the catalog comes first, so a custom action stored before the
 * catalog gained an action of its name never replaces that action.
 */
export function actionSetOf(actions: readonly Action[]): ActionSet {
  const byName = new Map<string, Action>();
  for (const action of actions) if (!byName.has(action.name)) byName.set(action.name, action);
  return { actions: [...byName.values()], find: (name) => byName.get(name) };
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
 * allows it: one list for a Google catalog action, or for a custom Google action (its Google
 * app's); none for one on what Mycel holds, or for a custom action in another app, which reaches
 * its app through a connection to that app.
 */
export function scopesOf(action: Action): (readonly string[])[] {
  if (action.kind === "catalog") return action.integration === "google" ? [action.scopes] : [];
  return action.scopes.length === 0 ? [] : [action.scopes];
}

function isMycelAction(action: Action): boolean {
  return action.kind === "catalog" && action.integration === "mycel";
}
