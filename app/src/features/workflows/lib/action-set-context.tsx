"use client";

// The company's action set in the browser (ADR-0018): what the graph, the step menu and the side
// panel look actions up in, so they offer and describe the actions saving would check against.
// Until custom actions are stored, every company's action set is the catalog, so that's the
// context's value; custom actions will come in through a provider their pages render.
import { createContext, useContext } from "react";
import { catalogActionSet } from "@/features/policy/catalog";
import type { ActionSet } from "@/features/policy/types";

const ActionSetContext = createContext<ActionSet>(catalogActionSet);

/** The action set of the company whose workflow is drawn or edited. */
export function useActionSet(): ActionSet {
  return useContext(ActionSetContext);
}
