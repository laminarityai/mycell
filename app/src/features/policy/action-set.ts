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
 * every workflow's trigger watches, then each action's app, each once.
 */
export function appsUsed(actionNames: readonly string[], actions: ActionSet): Action["app"][] {
  const apps = actionNames.flatMap((name) => actions.find(name)?.app ?? []);
  return [...new Set<Action["app"]>(["Gmail", ...apps])];
}
