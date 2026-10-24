// An org's action set (ADR-0018): the actions its workflows may use, looked up by name.
// `custom-actions` resolves one per org; everything that looks an action up takes it.
// Pure: no IO, no ctx, so client code may import it.
import { triggers, type TriggerType } from "@/features/spec/triggers";
import { GOOGLE_API_PREFIXES, GOOGLE_APP_NAMES } from "@/lib/google";
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
 * The apps a workflow calling `actionNames` uses, as admins name them: the app its trigger
 * watches (Gmail's new mail unless the trigger says otherwise), then each action's app, each
 * once. A custom Google action's
 * app is the Google app its path reaches (Calendar, say), or Google when none does. An action on
 * what Mycel itself holds (memory) uses no app.
 */
export function appsUsed(
  actionNames: readonly string[],
  actions: ActionSet,
  trigger: TriggerType = "gmail.message_received",
): string[] {
  const apps = actionNames.flatMap((name) => {
    const action = actions.find(name);
    return action === undefined || isMycelAction(action) ? [] : [appOf(action)];
  });
  return [...new Set<string>([triggers[trigger].app, ...apps])];
}

// The app an action acts in, as admins name it.
function appOf(action: Action): string {
  if (action.kind !== "custom" || action.registeredApp !== "google") return action.app;
  const google = GOOGLE_API_PREFIXES.find(({ prefix }) => action.request.path.startsWith(prefix));
  return google === undefined ? action.app : GOOGLE_APP_NAMES[google.app];
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
