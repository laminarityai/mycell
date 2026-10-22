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
 * every workflow's trigger watches, then each action's app, each once.
 */
export function appsUsed(actionNames: readonly string[], actions: ActionSet): Action["app"][] {
  const apps = actionNames.flatMap((name) => actions.find(name)?.app ?? []);
  return [...new Set<Action["app"]>(["Gmail", ...apps])];
}
